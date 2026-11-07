import { OFFER, REPAIR_PER_SQFT } from "./config";
import type { Listing, PhotoAssessment } from "./types";

export type Action = "offer" | "showing_request" | "skip" | "needs_data";

export interface OfferDecision {
  action: Action;
  repairsLow: number | null;
  repairsHigh: number | null;
  offer: number | null;
  formula: string;
  pctOfList: number | null;
  reasons: string[];
}

export function decideOffer(
  l: Listing,
  arv: number | null,
  photo: PhotoAssessment,
  flood: { sfha: boolean | null },
): OfferDecision {
  const reasons: string[] = [];
  if (!arv || !l.sqft) {
    return { action: "needs_data", repairsLow: null, repairsHigh: null, offer: null, formula: "-", pctOfList: null, reasons: ["No ARV or sqft"] };
  }

  const unknownCondition = photo.tier === "unknown" || !photo.hasInterior || photo.confidence < 0.5;
  const tier = photo.tier === "unknown" ? "heavy" : photo.tier; // assume heavy when blind
  const rate = REPAIR_PER_SQFT[tier];
  const repairsLow = Math.round((rate.low * l.sqft) / 1000) * 1000;
  const repairsHigh = Math.round((rate.high * l.sqft) / 1000) * 1000;

  // FEMA 50% rule: in a flood zone, big rehab may force elevation.
  if (flood.sfha && (tier === "heavy" || tier === "gut")) {
    reasons.push("Flood zone + heavy rehab: FEMA 50% rule may require elevation. Price elevation before offering.");
  }

  let offer: number;
  let formula: string;
  const useDeep = unknownCondition || tier === "gut" || arv < OFFER.deepWhenArvBelow;
  if (useDeep) {
    offer = arv * OFFER.deepPctOfArv;
    formula = `ARV ${fmt(arv)} x ${OFFER.deepPctOfArv}`;
    if (tier === "gut") { offer -= repairsHigh * 0.5; formula += ` - 50% of gut repairs`; }
    reasons.push(unknownCondition ? "Condition unknown (no/unclear interior photos) -> 60% of ARV" : arv < OFFER.deepWhenArvBelow ? "Low ARV -> 60% of ARV" : "Gut -> 60% rule");
  } else {
    offer = arv * OFFER.standardPctOfArv - repairsHigh; // use HIGH repair number: downside first
    formula = `ARV ${fmt(arv)} x ${OFFER.standardPctOfArv} - repairs ${fmt(repairsHigh)}`;
  }

  const cap = l.listPrice * OFFER.maxPctOfList;
  if (offer > cap) { offer = cap; reasons.push(`Capped at ${OFFER.maxPctOfList * 100}% of list`); }
  offer = Math.floor(offer / 1000) * 1000;
  const pct = offer / l.listPrice;

  if (offer <= 0) return { action: "skip", repairsLow, repairsHigh, offer: null, formula, pctOfList: null, reasons: [...reasons, "Numbers don't work at any price"] };

  // Price looks good but we're blind on condition -> go see it.
  if (unknownCondition && l.listPrice <= arv * 0.75) {
    return { action: "showing_request", repairsLow, repairsHigh, offer, formula, pctOfList: pct, reasons: [...reasons, "List price already near buy zone; condition unknown -> request showing"] };
  }
  if (pct < OFFER.minOfferPctOfList) {
    return { action: "skip", repairsLow, repairsHigh, offer, formula, pctOfList: pct, reasons: [...reasons, `Offer only ${(pct * 100).toFixed(0)}% of list — watch for price drops instead`] };
  }
  return { action: "offer", repairsLow, repairsHigh, offer, formula, pctOfList: pct, reasons };
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
