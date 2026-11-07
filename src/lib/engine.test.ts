import { describe, it, expect } from "vitest";
import { scanRemarks } from "./keywords";
import { computeArv } from "./comps";
import { decideOffer } from "./offer";
import { scoreListing } from "./score";
import type { Listing, SoldComp } from "./types";

const subject: Listing = {
  mlsNumber: "1", address: "10 Test Ave", city: "Galloway", lat: 39.47, lon: -74.5,
  listPrice: 180_000, beds: 3, sqft: 1500, propertyType: "sfr",
  remarks: "Handyman special! Sold AS IS. Cash only. Bring your vision.", event: "new", photoUrls: [],
};
const comp = (price: number, dLat: number, beds = 3, sqft = 1500, remarks = "Renovated"): SoldComp => ({
  address: "c", lat: 39.47 + dLat, lon: -74.5, beds, sqft, propertyType: "sfr",
  salePrice: price, closeDate: "2026-09-15", remarks,
});

describe("keywords", () => {
  it("prefers longest phrase, no double count", () => {
    const r = scanRemarks(subject.remarks);
    expect(r.hits).toContain("handyman special");
    expect(r.hits).toContain("sold as is");
    expect(r.hits).not.toContain("as is");
    expect(r.hits).toContain("cash only");
  });
  it("does not match inside words", () => {
    expect(scanRemarks("Gorgeous estate-quality reorganized kitchen").hits).not.toContain("reo");
  });
});

describe("ARV", () => {
  const now = new Date("2026-11-01");
  it("averages 3-4 nearby retail comps, excludes distressed and wrong beds", () => {
    const sold = [
      comp(300_000, 0.001), comp(310_000, 0.002), comp(290_000, 0.003), comp(305_000, 0.004),
      comp(150_000, 0.001, 3, 1500, "Sold as-is, needs work"), // distressed -> excluded
      comp(400_000, 0.001, 4), // 4 beds -> excluded
    ];
    const r = computeArv(subject, sold, now);
    expect(r.comps).toHaveLength(4);
    expect(r.arv).toBe(301_000);
  });
  it("returns null with <3 comps", () => {
    expect(computeArv(subject, [comp(300_000, 0.001)], now).arv).toBeNull();
  });
});

describe("offer", () => {
  it("70% rule with high repair estimate", () => {
    const d = decideOffer({ ...subject, listPrice: 260_000 }, 300_000, { tier: "moderate", hasInterior: true, confidence: 0.8, notes: "" }, { sfha: false });
    // 300k*0.7 - 45*1500(68k rounded) = 210k-68k = 142k
    expect(d.offer).toBe(142_000);
    expect(d.action).toBe("offer");
  });
  it("blind condition + list already in buy zone -> showing request at 60%", () => {
    const d = decideOffer(subject, 300_000, { tier: "unknown", hasInterior: false, confidence: 0, notes: "" }, { sfha: false });
    expect(d.action).toBe("showing_request");
    expect(d.offer).toBe(180_000 * 0.85 > 180_000 ? 0 : 153_000); // capped at 85% of list
  });
  it("flags FEMA 50% rule in flood zone", () => {
    const d = decideOffer(subject, 300_000, { tier: "gut", hasInterior: true, confidence: 0.9, notes: "" }, { sfha: true });
    expect(d.reasons.join(" ")).toMatch(/FEMA 50%/);
  });
});

describe("score", () => {
  it("high score for keywords + list at 60% of ARV", () => {
    expect(scoreListing(subject, 300_000).score).toBeGreaterThanOrEqual(70);
  });
});
