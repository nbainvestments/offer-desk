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
  user: { repairs?: number | null } = {},
): OfferDecision {
  const reasons: string[] = [];
  const userRepairs = user.repairs != null && user.repairs >= 0 ? user.repairs : null;
  if (!arv || (!l.sqft && userRepairs == null)) {
    return { action: "needs_data", repairsLow: null, repairsHigh: null, offer: null, formula: "-", pctOfList: null, reasons: ["No ARV or sqft"] };
  }

  // Your repair number wins: you've judged the condition, so no "blind" 60% rule.
  const unknownCondition = userRepairs == null && (photo.tier === "unknown" || !photo.hasInterior || photo.confidence < 0.5);
  const tier = photo.tier === "unknown" ? "heavy" : photo.tier; // assume heavy when blind
  const rate = REPAIR_PER_SQFT[tier];
  const repairsLow = userRepairs ?? Math.round((rate.low * (l.sqft ?? 0)) / 1000) * 1000;
  const repairsHigh = userRepairs ?? Math.round((rate.high * (l.sqft ?? 0)) / 1000) * 1000;
  if (userRepairs != null) reasons.push(`Repairs set by you: ${fmt(userRepairs)}`);

  // FEMA 50% rule: in a flood zone, big rehab may force elevation.
  if (flood.sfha && (tier === "heavy" || tier === "gut")) {
    reasons.push("Flood zone + heavy rehab: FEMA 50% rule may require elevation. Price elevation before offering.");
  }

  let offer: number;
  let formula: string;
  const useDeep = userRepairs == null && (unknownCondition || tier === "gut" || arv < OFFER.deepWhenArvBelow);
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
  if (pct < OFFER.minOfferPctOfList && userRepairs != null) reasons.push(`Heads up: offer is only ${(pct * 100).toFixed(0)}% of list`);
  if (pct < OFFER.minOfferPctOfList && userRepairs == null) {
    return { action: "skip", repairsLow, repairsHigh, offer, formula, pctOfList: pct, reasons: [...reasons, `Offer only ${(pct * 100).toFixed(0)}% of list — watch for price drops instead`] };
  }
  return { action: "offer", repairsLow, repairsHigh, offer, formula, pctOfList: pct, reasons };
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
