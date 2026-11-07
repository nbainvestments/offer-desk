// Central settings. Every number here is an assumption you can change.

export const BUY_BOX = {
  maxListPrice: 750_000,
  propertyTypes: "all" as const, // SFR, 2-4 unit, condo, townhouse, land
};

// Remarks keywords (case-insensitive). Weight = how strongly it signals a discount.
export const KEYWORDS: Record<string, number> = {
  // user's list
  "fixer upper": 3, "fixer-upper": 3, "handyman special": 3, "tlc": 2,
  "as-is": 2, "as is": 2, "cash only": 3, "investor special": 3,
  "motivated seller": 2, "distressed": 3, "needs work": 2,
  "renovation needed": 3, "rehab needed": 3, "needs rehab": 3,
  "complete renovation": 3, "full renovation": 3, "teardown": 3, "tear down": 3,
  "rebuild": 2, "abandoned": 3, "vacant": 1, "foreclosure": 3,
  // additions
  "bank owned": 3, "reo": 2, "short sale": 2, "estate sale": 2, "estate": 1,
  "sold as is": 3, "being sold in its current condition": 3, "current condition": 2,
  "bring your vision": 2, "opportunity to renovate": 2, "contractor special": 3,
  "builder special": 2, "fire damage": 3, "water damage": 3, "mold": 2,
  "no repairs": 2, "cash or rehab loan": 3, "203k": 2, "needs updating": 1,
  "needs tlc": 2, "potential": 1, "sweat equity": 3, "probate": 2,
  "price reduced": 1, "priced to sell": 1, "below market": 1,
};

// Words that mean a sold comp is NOT retail condition (excluded from ARV).
export const DISTRESSED_COMP_WORDS = [
  "as-is", "as is", "fixer", "handyman", "tlc", "cash only", "investor",
  "needs work", "rehab", "renovation needed", "teardown", "tear down",
  "foreclosure", "bank owned", "reo", "short sale", "estate", "fire damage",
  "water damage", "contractor special", "current condition",
];

// Repair cost per sqft by condition tier (South Jersey, rough — CALIBRATE with real bids).
export const REPAIR_PER_SQFT = {
  turnkey: { low: 0, high: 8 },
  cosmetic: { low: 15, high: 25 },
  moderate: { low: 30, high: 45 },
  heavy: { low: 50, high: 70 },
  gut: { low: 80, high: 110 },
} as const;
export type ConditionTier = keyof typeof REPAIR_PER_SQFT;

export const OFFER = {
  standardPctOfArv: 0.7, // ARV x 0.70 - repairs
  deepPctOfArv: 0.6,     // ARV x 0.60 (unknown condition / heavy work / low ARV)
  deepWhenArvBelow: 150_000, // low-ARV houses: thin margins, use 60%
  maxPctOfList: 0.85,    // never offer above this % of list
  minOfferPctOfList: 0.4, // below this, send a showing request instead (offer would just burn the agent)
  closeDays: 21,
};

export const COMPS = {
  daysBack: 90,            // user rule: sales closed in the last 90 days (market moving)
  fallbackDaysBack: 180,   // backup only: 91–180 day sales when recent comps are missing/weak, flagged "older comp"
  radiusMiles: [0.5, 1, 2], // widen until enough comps
  sqftTolerance: 0.2,       // +/-20%
  sameBeds: true,
  bathTolerance: 1,         // +/-1 bath (when both sides have baths)
  minComps: 3,
  maxComps: 4,
};

export const ALERTS = {
  hotDealMinScore: 70, // push to phone at/above this score
};
