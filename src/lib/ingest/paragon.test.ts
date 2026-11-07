import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { parseParagonAlert } from "./paragon";

const load = (f: string) => parseParagonAlert(readFileSync(`test/fixtures/${f}.html`, "utf8"));

// Fixtures are real alert emails (contain a private portal token) — kept out of git.
describe.skipIf(!existsSync("test/fixtures/6e94ddbe.html"))("Paragon alert parser", () => {
  it("parses a single listing (back-on-market search)", () => {
    const r = load("6e94ddbe");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ mlsNumber: "613532", address: "121 Reading", city: "Tuckahoe", zip: "08270", listPrice: 450_000, beds: 4, baths: 2.5, propertyType: "sfr" });
    expect(r[0].detailUrl).toMatch(/DetailTokenLogon/);
  });
  it("parses multiple listings with separate detail links", () => {
    const r = load("40092c17");
    expect(r.map((x) => x.mlsNumber)).toEqual(["613275", "613400"]);
    expect(r[1]).toMatchObject({ address: "50 Pembrooke Way", city: "Smithville", listPrice: 458_000, beds: 2, baths: 2 });
    expect(r[0].detailUrl).not.toEqual(r[1].detailUrl);
  });
  it("parses third sample", () => {
    expect(load("f93633a0")[0]).toMatchObject({ mlsNumber: "613448", city: "Egg Harbor Township", listPrice: 499_900, event: "new" });
  });
});
