// FEMA National Flood Hazard Layer (free, public). Layer 28 = Flood Hazard Zones.
const NFHL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query";

export async function floodZone(lat: number, lon: number): Promise<{ zone: string | null; sfha: boolean | null }> {
  const p = new URLSearchParams({
    geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326",
    spatialRel: "esriSpatialRelIntersects", outFields: "FLD_ZONE,SFHA_TF", returnGeometry: "false", f: "json",
  });
  try {
    const r = await fetch(`${NFHL}?${p}`, { signal: AbortSignal.timeout(10_000) });
    const j = await r.json();
    const a = j.features?.[0]?.attributes;
    // Empty result = no mapped polygon at this point. NEVER treat as safe — flag for manual FEMA map check.
    if (!a) return { zone: null, sfha: null };
    return { zone: a.FLD_ZONE ?? null, sfha: a.SFHA_TF === "T" };
  } catch {
    return { zone: null, sfha: null }; // unknown — app shows "check flood"
  }
}

// US Census geocoder (free) for listings without coordinates.
export async function geocode(address: string): Promise<{ lat: number; lon: number } | null> {
  const p = new URLSearchParams({ address, benchmark: "Public_AR_Current", format: "json" });
  try {
    const r = await fetch(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${p}`, { signal: AbortSignal.timeout(10_000) });
    const m = (await r.json()).result?.addressMatches?.[0]?.coordinates;
    return m ? { lat: m.y, lon: m.x } : null;
  } catch { return null; }
}
