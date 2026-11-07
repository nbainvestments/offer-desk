// NJ MOD-IV tax records (public, NJ Office of GIS). Works for any address — MLS or off-market.
// Has owner, year built, building description, last deed sale, assessed values, lot size.
// Does NOT have beds/baths/sqft (NJ tax records don't carry them).
const URL_ = "https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0/query";

export interface TaxRecord {
  owner?: string; ownerMailing?: string; location?: string; municipality?: string; blockLot?: string;
  propClass?: string; propClassLabel?: string; buildingDesc?: string; yearBuilt?: number; acres?: number;
  landValue?: number; improvementValue?: number; netValue?: number; lastYearTax?: number;
  lastSalePrice?: number; lastSaleDate?: string; absenteeOwner?: boolean;
}

const CLASS: Record<string, string> = {
  "1": "Vacant land", "2": "Residential (1–4 family)", "3A": "Farm (house)", "3B": "Farm (qualified)",
  "4A": "Commercial", "4B": "Industrial", "4C": "Apartment (5+ units)", "15C": "Public property", "15F": "Other exempt",
};

/** "220609" -> "2022-06-09" (MOD-IV stores deed dates as YYMMDD). */
function deedDate(s?: string | null) {
  const m = String(s ?? "").match(/^(\d{2})(\d{2})(\d{2})$/);
  if (!m) return undefined;
  const yy = Number(m[1]);
  return `${yy > 50 ? 1900 + yy : 2000 + yy}-${m[2]}-${m[3]}`;
}

export async function taxRecordAt(lat: number, lon: number, address?: string): Promise<TaxRecord | null> {
  const p = new URLSearchParams({
    // Geocoded points sit on the street, not inside the lot: search ~100 m around and match the house number.
    geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
    distance: "100", units: "esriSRUnit_Meter",
    outFields: "OWNER_NAME,ST_ADDRESS,CITY_STATE,PROP_LOC,MUN_NAME,PCLBLOCK,PCLLOT,PCLQCODE,PROP_CLASS,BLDG_DESC,YR_CONSTR,CALC_ACRE,LAND_VAL,IMPRVT_VAL,NET_VALUE,LAST_YR_TX,SALE_PRICE,DEED_DATE",
    returnGeometry: "false", f: "json",
  });
  try {
    const r = await fetch(`${URL_}?${p}`, { signal: AbortSignal.timeout(12_000) });
    const feats: any[] = ((await r.json()).features ?? []).map((f: any) => f.attributes);
    if (!feats.length) return null;
    const houseNo = String(address ?? "").trim().match(/^(\d+)/)?.[1];
    const street = String(address ?? "").replace(/^\d+\s*/, "").split(/[ ,]/).filter((w) => w.length > 2 && !/^(n|s|e|w|north|south|east|west)$/i.test(w))[0]?.toUpperCase();
    const score = (x: any) => {
      const loc = String(x.PROP_LOC ?? "").toUpperCase();
      return (houseNo && loc.startsWith(houseNo + " ") ? 2 : 0) + (street && loc.includes(street) ? 1 : 0);
    };
    const best = feats.sort((p1, p2) => score(p2) - score(p1))[0];
    if (address && score(best) < 2) return null; // don't show a neighbor's record
    const a = best;
    return toRecord(a);
  } catch {
    return null;
  }
}

function toRecord(a: any): TaxRecord {
    const mailing = [a.ST_ADDRESS, a.CITY_STATE].filter(Boolean).join(", ");
  return {
    // NJ redacts many owner names (Daniel's Law)
    owner: a.OWNER_NAME || undefined, ownerMailing: mailing || undefined, location: a.PROP_LOC ?? undefined, municipality: a.MUN_NAME ?? undefined,
    blockLot: `Block ${a.PCLBLOCK} Lot ${a.PCLLOT}${a.PCLQCODE ? ` ${a.PCLQCODE}` : ""}`,
    propClass: a.PROP_CLASS ?? undefined, propClassLabel: CLASS[a.PROP_CLASS] ?? a.PROP_CLASS,
    buildingDesc: a.BLDG_DESC ?? undefined, yearBuilt: a.YR_CONSTR || undefined, acres: a.CALC_ACRE ? Math.round(a.CALC_ACRE * 100) / 100 : undefined,
    landValue: a.LAND_VAL || undefined, improvementValue: a.IMPRVT_VAL || undefined, netValue: a.NET_VALUE || undefined,
    lastYearTax: a.LAST_YR_TX || undefined, lastSalePrice: a.SALE_PRICE || undefined, lastSaleDate: deedDate(a.DEED_DATE),
    // owner mails tax bills somewhere other than the property -> likely landlord / out-of-area owner
    absenteeOwner: !!(a.PROP_LOC && a.ST_ADDRESS && !String(a.ST_ADDRESS).toUpperCase().startsWith(String(a.PROP_LOC).toUpperCase().split(" ")[0])),
  };
}

const ORD = ["", "FIRST", "SECOND", "THIRD", "FOURTH", "FIFTH", "SIXTH", "SEVENTH", "EIGHTH", "NINTH", "TENTH", "ELEVENTH", "TWELFTH",
  "THIRTEENTH", "FOURTEENTH", "FIFTEENTH", "SIXTEENTH", "SEVENTEENTH", "EIGHTEENTH", "NINETEENTH", "TWENTIETH"];
const DIRS = /^(N|S|E|W|NORTH|SOUTH|EAST|WEST)$/;

/** Text lookup when the geocoder can't place an address. Returns the record + parcel location. */
export async function taxRecordByAddress(address: string): Promise<(TaxRecord & { lat: number; lon: number }) | null> {
  const parts = address.toUpperCase().replace(/[.#]/g, " ").split(",");
  const words = parts[0].trim().split(/\s+/);
  const num = words[0]?.match(/^\d+[A-Z]?$/) ? words.shift()! : null;
  if (!num) return null;
  const streetWord = words.find((w) => !DIRS.test(w)) ?? "";
  const ordinal = streetWord.match(/^(\d+)(ST|ND|RD|TH)$/);
  const variants = [streetWord, ordinal ? ORD[Number(ordinal[1])] : ""].filter(Boolean);
  const town = (parts[1] ?? "").replace(/\b(TOWNSHIP|TWP|CITY|BORO(UGH)?|NJ|NEW JERSEY|\d{5})\b/g, "").trim().split(/\s+/)[0] ?? "";
  for (const v of variants) {
    const where = `COUNTY IN ('ATLANTIC','CAPE MAY') AND PROP_LOC LIKE '${num.replace(/'/g, "")} ${v.replace(/'/g, "")}%'`;
    const p = new URLSearchParams({ where, outFields: "*", returnGeometry: "true", outSR: "4326", f: "json" });
    try {
      const r = await fetch(`${URL_}?${p}`, { signal: AbortSignal.timeout(12_000) });
      const feats: any[] = (await r.json()).features ?? [];
      if (!feats.length) continue;
      const f = feats.find((x) => town && String(x.attributes.MUN_NAME ?? "").includes(town)) ?? (feats.length === 1 ? feats[0] : null);
      if (!f) continue;
      const ring: number[][] = f.geometry?.rings?.[0] ?? [];
      const lon = ring.reduce((t, c) => t + c[0], 0) / (ring.length || 1);
      const lat = ring.reduce((t, c) => t + c[1], 0) / (ring.length || 1);
      return { ...toRecord(f.attributes), lat, lon };
    } catch { /* try next variant */ }
  }
  return null;
}
