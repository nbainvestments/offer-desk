import { COMPS, DISTRESSED_COMP_WORDS } from "./config";
import { containsAny } from "./keywords";
import type { Listing, SoldComp } from "./types";

export function milesBetween(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface ArvResult {
  arv: number | null;          // user's method: average of comp sale prices
  arvPerSqft: number | null;   // cross-check: avg $/sqft x subject sqft
  comps: (SoldComp & { miles: number })[];
  radiusUsed: number | null;
  warnings: string[];
}

export function computeArv(subject: Listing, sold: SoldComp[], now = new Date()): ArvResult {
  const warnings: string[] = [];
  if (subject.lat == null || subject.lon == null || !subject.sqft) {
    return { arv: null, arvPerSqft: null, comps: [], radiusUsed: null, warnings: ["Missing location or sqft — ARV not computed"] };
  }
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - COMPS.monthsBack);

  const base = sold
    .filter((c) => new Date(c.closeDate) >= cutoff)
    .filter((c) => sameTypeGroup(c.propertyType, subject.propertyType))
    .filter((c) => !COMPS.sameBeds || subject.beds == null || c.beds === subject.beds)
    .filter((c) => Math.abs(c.sqft - subject.sqft!) / subject.sqft! <= COMPS.sqftTolerance)
    .filter((c) => !containsAny(c.remarks, DISTRESSED_COMP_WORDS)) // retail-condition only
    .map((c) => ({ ...c, miles: milesBetween(subject.lat!, subject.lon!, c.lat, c.lon) }));

  for (const r of COMPS.radiusMiles) {
    const within = base.filter((c) => c.miles <= r);
    if (within.length >= COMPS.minComps) {
      // closest + most recent first
      const picked = within
        .sort((a, b) => a.miles - b.miles || +new Date(b.closeDate) - +new Date(a.closeDate))
        .slice(0, COMPS.maxComps);
      const arv = avg(picked.map((c) => c.salePrice));
      const ppsf = avg(picked.map((c) => c.salePrice / c.sqft));
      const arvPerSqft = ppsf * subject.sqft;
      if (Math.abs(arv - arvPerSqft) / arvPerSqft > 0.15) warnings.push("Comp average and $/sqft method disagree >15% — review comps");
      if (r > COMPS.radiusMiles[0]) warnings.push(`Had to widen radius to ${r} mi`);
      const spread = Math.max(...picked.map((c) => c.salePrice)) / Math.min(...picked.map((c) => c.salePrice));
      if (spread > 1.4) warnings.push("Comp prices vary >40% — ARV unreliable");
      return { arv: round(arv), arvPerSqft: round(arvPerSqft), comps: picked, radiusUsed: r, warnings };
    }
  }
  return { arv: null, arvPerSqft: null, comps: [], radiusUsed: null, warnings: [`Fewer than ${COMPS.minComps} retail comps found`] };
}

function sameTypeGroup(a: string, b: string) {
  const g = (t: string) => (t === "condo" || t === "townhouse" ? "attached" : t);
  return g(a) === g(b);
}
const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const round = (n: number) => Math.round(n / 1000) * 1000;
