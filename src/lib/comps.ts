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

export interface CompOpts { sqftTolerance?: number; bathTolerance?: number; radiusMiles?: number[]; daysBack?: number }

/** Shared comp filter: same type, same 55+, same beds, baths ±1, sqft ±X%, closed within daysBack (default 90). */
export function compMatches(subject: Listing, c: SoldComp, opts: CompOpts = {}, now = new Date()) {
  const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - (opts.daysBack ?? COMPS.daysBack));
  const sqftTol = opts.sqftTolerance ?? COMPS.sqftTolerance;
  const bathTol = opts.bathTolerance ?? COMPS.bathTolerance;
  return new Date(c.closeDate) >= cutoff
    && c.propertyType === subject.propertyType
    && !!c.age55 === !!subject.age55
    && (!COMPS.sameBeds || subject.beds == null || c.beds === subject.beds)
    && (subject.baths == null || c.baths == null || Math.abs(c.baths - subject.baths) <= bathTol)
    && (!subject.sqft || (!!c.sqft && Math.abs(c.sqft - subject.sqft) / subject.sqft <= sqftTol));
}

/** True when a sale closed more than the main window ago (91–180 days): shown as "older comp". */
export function isOlderComp(c: { closeDate: string }, now = new Date()) {
  return (now.getTime() - new Date(c.closeDate).getTime()) / 86_400_000 > COMPS.daysBack;
}

function arvFromWindow(subject: Listing, sold: SoldComp[], now: Date, opts: CompOpts, days: number): ArvResult {
  const warnings: string[] = [];
  const radii = opts.radiusMiles ?? COMPS.radiusMiles;
  const base = sold
    .filter((c) => compMatches(subject, c, { ...opts, daysBack: days }, now))
    .filter((c) => !containsAny(c.remarks, DISTRESSED_COMP_WORDS)) // retail-condition only
    .map((c) => ({ ...c, miles: milesBetween(subject.lat!, subject.lon!, c.lat, c.lon), older: isOlderComp(c, now) }));

  for (const r of radii) {
    const within = base.filter((c) => c.miles <= r);
    if (within.length >= COMPS.minComps) {
      // recent first, then closest
      const picked = within
        .sort((a, b) => Number(a.older) - Number(b.older) || a.miles - b.miles || +new Date(b.closeDate) - +new Date(a.closeDate))
        .slice(0, COMPS.maxComps);
      const arv = avg(picked.map((c) => c.salePrice));
      const ppsf = avg(picked.map((c) => c.salePrice / c.sqft));
      const arvPerSqft = ppsf * subject.sqft!;
      if (Math.abs(arv - arvPerSqft) / arvPerSqft > 0.15) warnings.push("Comp average and $/sqft method disagree >15% — review comps");
      if (r > radii[0]) warnings.push(`Had to widen radius to ${r} mi`);
      const spread = Math.max(...picked.map((c) => c.salePrice)) / Math.min(...picked.map((c) => c.salePrice));
      if (spread > 1.4) warnings.push("Comp prices vary >40% — ARV unreliable");
      const nOld = picked.filter((c) => c.older).length;
      if (nOld) warnings.push(`Uses ${nOld} older comp${nOld > 1 ? "s" : ""} (${COMPS.daysBack + 1}–${COMPS.fallbackDaysBack} days) — review before offering`);
      return { arv: round(arv), arvPerSqft: round(arvPerSqft), comps: picked, radiusUsed: r, warnings };
    }
  }
  return { arv: null, arvPerSqft: null, comps: [], radiusUsed: null, warnings: [`Fewer than ${COMPS.minComps} retail comps found`] };
}

/** "Weak" = no ARV, comps disagree, or had to reach 2+ miles. */
const weak = (r: ArvResult) => r.arv == null || r.warnings.some((w) => /unreliable|disagree/.test(w)) || (r.radiusUsed ?? 99) >= 2;

export function computeArv(subject: Listing, sold: SoldComp[], now = new Date(), opts: CompOpts = {}): ArvResult {
  if (subject.lat == null || subject.lon == null || !subject.sqft) {
    return { arv: null, arvPerSqft: null, comps: [], radiusUsed: null, warnings: ["Missing location or sqft — ARV not computed"] };
  }
  const recent = arvFromWindow(subject, sold, now, opts, opts.daysBack ?? COMPS.daysBack);
  if (!weak(recent) || opts.daysBack) return recent;
  // Backup: reach back to 3–6 months only when recent comps are missing or weak, and only if it's actually better.
  const wider = arvFromWindow(subject, sold, now, opts, COMPS.fallbackDaysBack);
  if (wider.arv == null) return recent;
  const better = recent.arv == null
    || (wider.radiusUsed ?? 99) < (recent.radiusUsed ?? 99)
    || (recent.warnings.some((w) => /unreliable|disagree/.test(w)) && !wider.warnings.some((w) => /unreliable|disagree/.test(w)));
  return better ? wider : recent;
}

const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const round = (n: number) => Math.round(n / 1000) * 1000;
