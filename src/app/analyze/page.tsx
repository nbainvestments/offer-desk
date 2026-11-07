import Link from "next/link";
import { sql, migrate } from "@/db";
import { computeArv, compMatches, milesBetween } from "@/lib/comps";
import { taxRecordAt, taxRecordByAddress } from "@/lib/taxRecords";
import { geocode, floodZone } from "@/lib/flood";
import { COMPS, OFFER, REPAIR_PER_SQFT } from "@/lib/config";
import type { Listing, PropertyType, SoldComp } from "@/lib/types";
import { Header, money, longDate } from "../ui";
import { setNumbers } from "../actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;
const n = (v?: string) => { const x = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(x) && x > 0 ? x : undefined; };

export default async function Analyze({ searchParams }: { searchParams: Promise<SP> }) {
  await migrate();
  const sp = await searchParams;
  const q = (sp.address ?? "").trim();
  const excluded = new Set((sp.x ?? "").split(",").filter(Boolean));
  const picked = new Set((sp.i ?? "").split(",").filter(Boolean));

  // 1) Find the subject: an MLS listing we already track, else geocode the address.
  let subject: (Listing & { listingId?: number }) | null = null;
  let note = "";
  if (q) {
    const [hit] = await sql`select * from listings where address ilike ${"%" + q.split(",")[0].trim() + "%"} order by hidden asc, first_seen desc limit 1`;
    if (hit) {
      subject = {
        listingId: Number(hit.listing_id), mlsNumber: hit.mls_number, address: hit.address, city: hit.city, lat: hit.lat, lon: hit.lon,
        listPrice: hit.list_price, beds: hit.beds != null ? Number(hit.beds) : undefined, baths: hit.baths != null ? Number(hit.baths) : undefined, sqft: hit.sqft ?? undefined,
        propertyType: (hit.property_type ?? "sfr") as PropertyType, age55: !!hit.age55, remarks: hit.remarks ?? "", event: "other", photoUrls: [],
      };
      note = `Matched MLS listing ${hit.mls_number}.`;
    } else {
      const g = (await geocode(/nj|new jersey/i.test(q) ? q : `${q}, NJ`)) ?? (await taxRecordByAddress(q)); // tax-record fallback
      if (g) {
        subject = { mlsNumber: "", address: q, city: "", lat: g.lat, lon: g.lon, listPrice: 0, propertyType: "sfr", remarks: "", event: "other", photoUrls: [] };
        note = "Not an active MLS listing — enter beds, baths and sqft below (XLeads has them). Year built, owner and last sale are filled from NJ tax records.";
      } else note = "Couldn't find that address. Try the full street, town and zip.";
    }
  }
  // User overrides
  if (subject) {
    subject.beds = n(sp.beds) ?? subject.beds;
    subject.sqft = n(sp.sqft) ?? subject.sqft;
    subject.baths = n(sp.baths) ?? subject.baths;
    if (sp.type) subject.propertyType = sp.type as PropertyType;
    if (sp.type) subject.age55 = sp.a55 === "1";
  }

  // 2) Comps (last 90 days, retail only) + ARV using the same engine as the scanner.
  const all: (SoldComp & { id: string })[] = (await sql`select * from sold_comps where lat is not null and sale_price >= 10000`).map((r: any) => ({
    id: String(r.listing_id), mlsNumber: String(r.listing_id), address: r.address, lat: r.lat, lon: r.lon, beds: Number(r.beds), baths: r.baths != null ? Number(r.baths) : undefined, sqft: r.sqft,
    propertyType: r.property_type ?? "sfr", age55: !!r.age55, salePrice: r.sale_price, closeDate: String(new Date(r.close_date).toISOString()), remarks: r.remarks ?? "",
  }));
  const tolPct = n(sp.tol) ?? COMPS.sqftTolerance * 100;
  const radius = n(sp.radius);
  const showAll = sp.all === "1";
  const opts = { sqftTolerance: tolPct / 100, radiusMiles: radius ? [radius] : undefined };
  const usable = all.filter((c) => !excluded.has(c.id) && c.sqft);
  const arv = subject && subject.lat != null ? computeArv(subject, usable, new Date(), opts) : null;
  const manualArv = n(sp.arv);
  const pickedComps = all.filter((c) => picked.has(c.id));
  const pickedArv = pickedComps.length ? Math.round(pickedComps.reduce((t, c) => t + c.salePrice, 0) / pickedComps.length / 1000) * 1000 : null;
  const finalArv = manualArv ?? pickedArv ?? arv?.arv ?? null;

  // Nearby sales list (wider net so you can eyeball / exclude)
  const cutoff = Date.now() - COMPS.daysBack * 86_400_000;
  const maxR = radius ?? 2;
  const nearby = subject?.lat != null
    ? all.map((c) => ({ ...c, miles: milesBetween(subject!.lat!, subject!.lon!, c.lat, c.lon) }))
        .filter((c) => c.miles <= maxR && new Date(c.closeDate).getTime() >= cutoff && c.propertyType === subject!.propertyType && !!c.age55 === !!subject!.age55)
        .filter((c) => showAll || compMatches(subject!, c, opts)) // beds exact, baths ±1, sqft ±tol
        .sort((a, b) => a.miles - b.miles).slice(0, 40)
    : [];
  const tax = subject?.lat != null ? (await taxRecordAt(subject.lat, subject.lon!, subject.address)) ?? (await taxRecordByAddress(`${subject.address}, ${subject.city}`)) : null;
  const usedIds = new Set((arv?.comps ?? []).map((c) => String(c.mlsNumber)));
  const flood = subject?.lat != null ? await floodZone(subject.lat, subject.lon!) : null;

  // 3) Offer math
  const repairs = n(sp.repairs);
  const offer70 = finalArv != null && repairs != null ? Math.floor((finalArv * OFFER.standardPctOfArv - repairs) / 1000) * 1000 : null;
  const offer60 = finalArv != null ? Math.floor((finalArv * OFFER.deepPctOfArv) / 1000) * 1000 : null;

  const keep = (extra: SP) => {
    const p = new URLSearchParams();
    const merged = { address: q, beds: sp.beds, baths: sp.baths, sqft: sp.sqft, tol: sp.tol, radius: sp.radius, all: sp.all, type: sp.type, a55: sp.a55, repairs: sp.repairs, arv: sp.arv, x: sp.x, i: sp.i, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/analyze?${p}`;
  };

  return (
    <div className="wrap">
      <Header tab="analyze" />
      <form className="filters" action="/analyze">
        <input type="search" name="address" placeholder="Address, e.g. 615 8th Ave, Galloway NJ" defaultValue={q} required />
        <button type="submit">Analyze</button>
      </form>
      {note && <p className="sub">{note}{subject?.listingId && <> · <Link href={`/listing/${subject.listingId}`}>Open listing</Link></>}</p>}

      {subject && (
        <div className="grid2">
          <div>
            <div className="card">
              <h3>Subject</h3>
              <form className="filters" action="/analyze">
                <input type="hidden" name="address" value={q} />
                {sp.x && <input type="hidden" name="x" value={sp.x} />}
                {sp.i && <input type="hidden" name="i" value={sp.i} />}
                <label className="sub">Beds <input type="number" name="beds" defaultValue={subject.beds ?? ""} style={{ width: 70 }} /></label>
                <label className="sub">Baths <input type="number" step="0.5" name="baths" defaultValue={subject.baths ?? ""} style={{ width: 70 }} /></label>
                <label className="sub">Sqft <input type="number" name="sqft" defaultValue={subject.sqft ?? ""} style={{ width: 100 }} /></label>
                <label className="sub">Sqft range <select name="tol" defaultValue={String(tolPct)}>
                  <option value="10">±10%</option><option value="15">±15%</option><option value="20">±20%</option><option value="25">±25%</option><option value="30">±30%</option>
                </select></label>
                <label className="sub">Radius <select name="radius" defaultValue={sp.radius ?? ""}>
                  <option value="">Auto (½→1→2 mi)</option><option value="0.25">¼ mi</option><option value="0.5">½ mi</option><option value="1">1 mi</option><option value="2">2 mi</option><option value="3">3 mi</option>
                </select></label>
                <label className="sub">Type <select name="type" defaultValue={subject.propertyType}>
                  <option value="sfr">Single family</option><option value="townhouse">Townhouse</option><option value="condo">Condo</option><option value="multi">Multi-family</option><option value="mobile">Mobile home</option>
                </select></label>
                <label className="sub"><input type="checkbox" name="a55" value="1" defaultChecked={!!subject.age55} /> 55+</label>
                <label className="sub">Est. repairs <input type="text" name="repairs" defaultValue={sp.repairs ?? ""} placeholder="$" style={{ width: 110 }} /></label>
                <label className="sub">Your ARV (optional) <input type="text" name="arv" defaultValue={sp.arv ?? ""} placeholder="override" style={{ width: 110 }} /></label>
                <button type="submit">Calculate</button>
              </form>
              <dl className="kv">
                <dt>Location</dt><dd>{subject.address}{subject.city ? `, ${subject.city}` : ""} {subject.lat != null && <a href={`https://www.google.com/maps?q=${subject.lat},${subject.lon}`} target="_blank">map</a>}</dd>
                {subject.listPrice > 0 && <><dt>List price</dt><dd>{money(subject.listPrice)}</dd></>}
                <dt>Flood zone</dt><dd>{flood?.zone ?? "Unknown — check FEMA map"}{flood?.sfha ? " (special flood hazard area)" : ""}</dd>
              </dl>
            </div>

            <div className="card">
              <h3>NJ tax record</h3>
              {!tax ? <p className="sub">No tax record found at this location.</p> : (
                <dl className="kv">
                  <dt>Owner</dt><dd>{tax.owner ?? "Not public (NJ redacts names) — check XLeads"}{tax.absenteeOwner && <span className="pill warn" style={{ marginLeft: 6 }}>mails elsewhere</span>}</dd>
                  {tax.ownerMailing && <><dt>Mailing address</dt><dd>{tax.ownerMailing}</dd></>}
                  <dt>Parcel</dt><dd>{tax.location} · {tax.municipality} · {tax.blockLot}</dd>
                  <dt>Class</dt><dd>{tax.propClassLabel ?? "—"}</dd>
                  <dt>Building</dt><dd>{tax.buildingDesc ?? "—"} <span className="sub">(assessor code)</span></dd>
                  <dt>Year built</dt><dd>{tax.yearBuilt ?? "—"}</dd>
                  <dt>Lot</dt><dd>{tax.acres ? `${tax.acres} acres` : "—"}</dd>
                  <dt>Assessed</dt><dd>{money(tax.netValue)} <span className="sub">(land {money(tax.landValue)} + building {money(tax.improvementValue)})</span></dd>
                  <dt>Taxes (last yr)</dt><dd>{tax.lastYearTax ? money(Math.round(tax.lastYearTax)) : "—"}</dd>
                  <dt>Last deed transfer</dt><dd>{tax.lastSalePrice == null ? "—" : tax.lastSalePrice < 1000
                    ? <>{longDate(tax.lastSaleDate)} · <span className="sub">${tax.lastSalePrice} — non-market transfer (family/estate/trust), not a sale price</span></>
                    : `${money(tax.lastSalePrice)} · ${longDate(tax.lastSaleDate)}`}</dd>
                </dl>
              )}
              <p className="sub" style={{ marginBottom: 0 }}>Public MOD-IV data. NJ tax records don't include beds/baths/sqft.</p>
            </div>

            <div className="card">
              <h3>ARV & offer</h3>
              <dl className="kv">
                <dt>ARV (comps)</dt><dd><b>{money(arv?.arv)}</b> {arv?.radiusUsed ? <span className="sub">from {arv.comps.length} comps within {arv.radiusUsed} mi</span> : ""}</dd>
                {arv?.arvPerSqft && <><dt>$/sqft check</dt><dd>{money(arv.arvPerSqft)}</dd></>}
                {pickedArv && <><dt>Your picked comps</dt><dd><b>{money(pickedArv)}</b> <span className="sub">avg of {pickedComps.length}{!manualArv ? " (used below)" : ""}</span></dd></>}
                {manualArv && <><dt>Your ARV</dt><dd><b>{money(manualArv)}</b> (used below)</dd></>}
                <dt>70% − repairs</dt><dd>{offer70 != null ? <b>{money(offer70)}</b> : <span className="sub">enter repairs</span>}{offer70 != null && <span className="sub"> = {money(finalArv)} × 0.70 − {money(repairs)}</span>}</dd>
                <dt>60% of ARV</dt><dd>{money(offer60)}</dd>
                {offer70 != null && subject.listPrice > 0 && <><dt>% of list</dt><dd>{Math.round((offer70 / subject.listPrice) * 100)}%</dd></>}
              </dl>
              {subject.listingId && finalArv != null && (
                <form action={setNumbers} className="filters" style={{ margin: "10px 0 0" }}>
                  <input type="hidden" name="listing_id" value={subject.listingId} />
                  <input type="hidden" name="arv" value={finalArv} />
                  <input type="hidden" name="repairs" value={repairs ?? ""} />
                  <input type="hidden" name="comp_ids" value={manualArv ? "" : pickedComps.length ? pickedComps.map((c) => c.id).join(",") : (arv?.comps ?? []).map((c) => String(c.mlsNumber)).join(",")} />
                  {subject.sqft && <input type="hidden" name="sqft" value={subject.sqft} />}
                  <button>Save ARV{pickedComps.length ? ` (${pickedComps.length} picked comps)` : ""}{repairs != null ? " + repairs" : ""} to this listing</button>
                  <span className="sub">→ re-prices it and drafts the offer</span>
                </form>
              )}
              {(arv?.warnings ?? []).map((w) => <p key={w} className="note" style={{ margin: "6px 0 0" }}>{w}</p>)}
              {subject.sqft && (
                <p className="sub" style={{ marginBottom: 0 }}>
                  Repair guide for {subject.sqft} sqft:{" "}
                  {Object.entries(REPAIR_PER_SQFT).filter(([k]) => k !== "turnkey").map(([k, r]) => `${k} ${money(r.low * subject!.sqft!)}–${money(r.high * subject!.sqft!)}`).join(" · ")}
                </p>
              )}
            </div>
          </div>

          <div className="card">
            <h3>Sold in last {COMPS.daysBack} days within {maxR} mi</h3>
            <p className="sub" style={{ marginTop: 0 }}>
              {showAll
                ? <>Showing <b>all {subject.propertyType}{subject.age55 ? " 55+" : ""}</b> sales (bed/bath/sqft filters off). <Link href={keep({ all: "" })}>Apply filters</Link></>
                : <>Filtered: <b>{subject.propertyType}{subject.age55 ? " · 55+" : ""}</b>{subject.beds != null && <> · <b>{subject.beds} bd</b></>}{subject.baths != null && <> · <b>{Math.max(0, subject.baths - 1)}–{subject.baths + 1} ba</b></>}{subject.sqft && <> · <b>{Math.round(subject.sqft * (1 - tolPct / 100))}–{Math.round(subject.sqft * (1 + tolPct / 100))} sqft</b></>}. <Link href={keep({ all: "1" })}>Show all nearby</Link></>}
            </p>
            <p className="sub" style={{ marginTop: 0 }}>✓ = auto-picked (also excludes distressed sales). Click <b>Use</b> on your own 3–4 comps to set the ARV yourself, or Exclude to drop a bad one.</p>
            {nearby.length === 0 ? <p className="sub">No matching sales. Try a wider sqft range or radius, or Show all nearby.</p> : (
              <div className="tablewrap"><table style={{ minWidth: 560 }}>
                <thead><tr><th></th><th>Address</th><th className="num">Bd</th><th className="num">Ba</th><th className="num">Sqft</th><th className="num">Sold</th><th>Closed</th><th className="num">Mi</th><th></th></tr></thead>
                <tbody>{nearby.map((c) => (
                  <tr key={c.id}>
                    <td>{picked.has(c.id) ? "★" : usedIds.has(c.id) ? "✓" : ""}</td>
                    <td>{c.address}</td><td className="num">{c.beds || "—"}</td><td className="num">{c.baths ?? "—"}</td><td className="num">{c.sqft ?? "—"}</td>
                    <td className="num">{money(c.salePrice)}</td><td>{longDate(c.closeDate)}</td><td className="num">{c.miles.toFixed(2)}</td>
                    <td style={{ display: "flex", gap: 10 }}>
                      {picked.has(c.id)
                        ? <Link href={keep({ i: [...picked].filter((v) => v !== c.id).join(",") })}>Unuse</Link>
                        : <Link href={keep({ i: [...picked, c.id].join(",") })}>Use</Link>}
                      <Link href={keep({ x: [...excluded, c.id].join(","), i: [...picked].filter((v) => v !== c.id).join(",") })}>Exclude</Link>
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            {(excluded.size > 0 || picked.size > 0) && <p className="sub">{picked.size} picked · {excluded.size} excluded · <Link href={keep({ x: "", i: "" })}>reset</Link></p>}
          </div>
        </div>
      )}
    </div>
  );
}
