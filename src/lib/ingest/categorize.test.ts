import { describe, it, expect } from "vitest";
import { categorize, is55 } from "./collab";
import { computeArv } from "../comps";
import type { Listing, SoldComp } from "../types";

describe("categorize (MLS data is often mis-entered)", () => {
  it("4993 Cardiff Ct: entered Single Family / 3 Story, but HOA + 'end-unit townhome' => townhouse", () => {
    expect(categorize({ classId: 1, type: "Single Family", style: "3 Story", address2: "END UNIT - Private side entrance!", hoa: 240,
      remarks: "this 4-bedroom, 2.5-bathroom end-unit townhome offers three spacious levels" })).toBe("townhouse");
  });
  it("Style Townhouse => townhouse", () => expect(categorize({ classId: 1, type: "Single Family", style: "Townhouse" })).toBe("townhouse"));
  it("Condo class => condo; Multi-family class => multi", () => {
    expect(categorize({ classId: 5 })).toBe("condo");
    expect(categorize({ classId: 4 })).toBe("multi");
  });
  it("mobile home", () => expect(categorize({ classId: 1, type: "Mobile Home w/o Land", style: "Ranch" })).toBe("mobile"));
  it("plain ranch stays sfr", () => expect(categorize({ classId: 1, type: "Single Family", style: "Ranch", remarks: "Lovely ranch home" })).toBe("sfr"));
  it("'townhouse' word without HOA does not flip a single family", () => expect(categorize({ classId: 1, type: "Single Family", style: "2 Story", remarks: "near the townhouse community" })).toBe("sfr"));
  it("55+ from flag or remarks", () => {
    expect(is55("1")).toBe(true);
    expect(is55("0", "desirable 55+ active adult golf course community")).toBe(true);
    expect(is55("0", "family neighborhood")).toBe(false);
  });
});

describe("ARV never mixes property types or 55+", () => {
  const base = { lat: 39.47, lon: -74.5, beds: 3, sqft: 1500, closeDate: new Date(Date.now() - 20 * 864e5).toISOString(), remarks: "updated" };
  const sold: SoldComp[] = [
    ...[300e3, 310e3, 305e3].map((p) => ({ ...base, address: "sfr", propertyType: "sfr" as const, salePrice: p })),
    ...[200e3, 210e3, 205e3].map((p) => ({ ...base, address: "th", propertyType: "townhouse" as const, salePrice: p })),
    ...[150e3, 155e3, 160e3].map((p) => ({ ...base, address: "th55", propertyType: "townhouse" as const, age55: true, salePrice: p })),
  ];
  const subj = (t: Listing["propertyType"], age55 = false): Listing => ({ mlsNumber: "1", address: "x", city: "y", lat: 39.47, lon: -74.5, listPrice: 1, beds: 3, sqft: 1500, propertyType: t, age55, remarks: "", event: "new", photoUrls: [] });
  it("townhouse uses only townhouse comps", () => expect(computeArv(subj("townhouse"), sold).arv).toBe(205e3));
  it("single family uses only single family comps", () => expect(computeArv(subj("sfr"), sold).arv).toBe(305e3));
  it("55+ townhouse uses only 55+ townhouse comps", () => expect(computeArv(subj("townhouse", true), sold).arv).toBe(155e3));
  it("condo with no condo comps gets no ARV (never borrows sfr)", () => expect(computeArv(subj("condo"), sold).arv).toBeNull());
});

describe("90-day comps first, 91–180 day backup flagged 'older'", () => {
  const now = new Date("2026-11-07");
  const daysAgo = (d: number) => new Date(now.getTime() - d * 864e5).toISOString();
  const comp = (price: number, days: number, dLat = 0.001) => ({ address: `${price}`, lat: 39.47 + dLat, lon: -74.5, beds: 3, sqft: 1500, propertyType: "sfr" as const, salePrice: price, closeDate: daysAgo(days), remarks: "" });
  const subj: Listing = { mlsNumber: "1", address: "x", city: "y", lat: 39.47, lon: -74.5, listPrice: 1, beds: 3, sqft: 1500, propertyType: "sfr", remarks: "", event: "new", photoUrls: [] };

  it("uses only recent comps when there are 3+ good ones", () => {
    const r = computeArv(subj, [comp(300e3, 10), comp(310e3, 20), comp(305e3, 30), comp(200e3, 150)], now);
    expect(r.arv).toBe(305e3);
    expect(r.comps.some((c: any) => c.older)).toBe(false);
  });
  it("falls back to older comps when fewer than 3 recent, and flags them", () => {
    const r = computeArv(subj, [comp(300e3, 10), comp(310e3, 120), comp(305e3, 150)], now);
    expect(r.arv).toBe(305e3);
    expect(r.comps.filter((c: any) => c.older)).toHaveLength(2);
    expect(r.warnings.join(" ")).toMatch(/older comp/);
  });
  it("prefers close older comps over recent ones 2 miles away", () => {
    const far = 0.025; // ~1.7 mi
    const r = computeArv(subj, [comp(400e3, 10, far), comp(410e3, 20, far), comp(405e3, 30, far), comp(300e3, 100), comp(305e3, 110), comp(310e3, 120)], now);
    expect(r.radiusUsed).toBe(0.5);
    expect(r.comps.some((c: any) => c.older)).toBe(true);
  });
  it("never uses sales older than 180 days", () => {
    expect(computeArv(subj, [comp(300e3, 200), comp(310e3, 220), comp(305e3, 250)], now).arv).toBeNull();
  });
});
