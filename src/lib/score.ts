import { BUY_BOX } from "./config";
import { scanRemarks } from "./keywords";
import type { Listing } from "./types";

// 0-100 deal score. Higher = look at it first.
export function scoreListing(l: Listing, arv: number | null): { score: number; signals: string[]; keywordHits: string[] } {
  const signals: string[] = [];
  let s = 0;
  if (l.listPrice > BUY_BOX.maxListPrice) return { score: 0, signals: ["Over max price"], keywordHits: [] };

  const kw = scanRemarks(l.remarks);
  s += Math.min(30, kw.score * 4);
  if (kw.hits.length) signals.push(`Keywords: ${kw.hits.join(", ")}`);

  if (arv) {
    const ratio = l.listPrice / arv;
    if (ratio <= 0.6) { s += 40; signals.push(`List is ${(ratio * 100).toFixed(0)}% of ARV`); }
    else if (ratio <= 0.7) { s += 30; signals.push(`List is ${(ratio * 100).toFixed(0)}% of ARV`); }
    else if (ratio <= 0.8) { s += 15; signals.push(`List is ${(ratio * 100).toFixed(0)}% of ARV`); }
  }

  if (l.event === "price_change" && l.originalListPrice && l.originalListPrice > l.listPrice) {
    const drop = 1 - l.listPrice / l.originalListPrice;
    s += drop >= 0.1 ? 15 : 8;
    signals.push(`Price cut ${(drop * 100).toFixed(0)}% from original`);
  }
  if (l.event === "back_on_market") { s += 10; signals.push("Back on market (deal fell through)"); }
  if (l.event === "expired" || l.event === "withdrawn") { s += 10; signals.push(`${l.event} — seller may be motivated`); }
  if (l.dom && l.dom >= 90) { s += 5; signals.push(`${l.dom} days on market`); }
  if (l.propertyType === "condo" && l.hoaMonthly && l.hoaMonthly > 400) signals.push(`High HOA $${l.hoaMonthly}/mo — check assessments`);

  return { score: Math.min(100, s), signals, keywordHits: kw.hits };
}
