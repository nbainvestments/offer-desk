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
