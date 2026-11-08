import { sql } from "@/db";
import { takeAiBudget } from "./aiBudget";
import { taxRecordAt } from "./taxRecords";
import { OFFER, REPAIR_PER_SQFT, COMPS } from "./config";

// The advisor's standing instructions — the user's own rules for how deals get judged.
const SYSTEM = `You are the deal advisor for NBA INVESTMENTS LLC (South Jersey, Atlantic County). You are an experienced investor
with your own money at risk. Truth over validation: never tell the user what they want to hear, never inflate chances, look for flaws first.
Judge the deal as a wholesaler, buy-and-hold investor, fix-and-flip investor, hard money lender, and end buyer.
Always separate VERIFIED facts (from the MLS data / comps / tax record given below) from ESTIMATES (AI photo condition, repair $/sqft,
web-sourced sqft, older comps). Never invent numbers; if something isn't in the data, say it's unknown and what to check.
Challenge the ARV (comp quality, distance, age, type match), the repair estimate, and the exit. Flag flood zone / FEMA 50% rule,
HOA/condo/55+ issues, DOM and price-cut signals, and probability the seller accepts.
The user's offer formula: ARV x ${OFFER.standardPctOfArv} - repairs (ARV x ${OFFER.deepPctOfArv} when condition unknown), cap ${OFFER.maxPctOfList * 100}% of list.
Comps: same type, same 55+ status, same beds, baths ±1, sqft ±20%, last ${COMPS.daysBack} days (older ${COMPS.daysBack + 1}-${COMPS.fallbackDaysBack} only as flagged backup).
Be direct and concise. Plain text, short paragraphs or short bullet lists, no tables.`;

const VERDICT_PROMPT = `Give your take on this deal using exactly this structure:
A. Reality Check — what is verified vs unsupported.
B. Risks — what could go wrong.
C. What's Missing — blind spots / what to verify before offering.
D. Verdict — strong deal, average deal, weak deal, or walk away (one line, with the price you'd actually offer and why).
E. Action Plan — 2-4 specific next steps.`;

export async function listingContext(id: number): Promise<string> {
  const [l] = await sql`select * from listings where listing_id = ${id}`;
  if (!l) throw new Error("Listing not found");
  const [o] = await sql`select kind, price, status from offers where listing_id = ${id} and status <> 'rejected' order by id desc limit 1`;
  const tax = l.lat != null ? await taxRecordAt(l.lat, l.lon, l.address).catch(() => null) : null;
  const comps = (l.arv_comps ?? []).map((c: any) =>
    `- ${c.address}: ${c.beds}bd/${c.baths ?? "?"}ba ${c.sqft ?? "?"}sf, sold $${Number(c.salePrice).toLocaleString()} on ${String(c.closeDate).slice(0, 10)}, ${c.miles?.toFixed?.(2) ?? "?"} mi${c.older ? " [OLDER COMP]" : ""}${c.sqftSource ? " [sqft from web]" : ""}`).join("\n");
  const tiers = l.sqft ? Object.entries(REPAIR_PER_SQFT).map(([k, r]) => `${k} $${(r.low * l.sqft).toLocaleString()}-$${(r.high * l.sqft).toLocaleString()}`).join("; ") : "n/a (no sqft)";
  return `LISTING (MLS ${l.mls_number}) — ${l.address}, ${l.city} ${l.zip ?? ""}
Status: ${l.status} | Event: ${l.event} | Days on market: ${l.dom ?? "?"} | List $${Number(l.list_price).toLocaleString()}${l.original_price && l.original_price > l.list_price ? ` (orig $${Number(l.original_price).toLocaleString()})` : ""}
Type: ${l.property_type}${l.age55 ? " (55+)" : ""} | MLS says: ${l.subtype || "?"} | ${l.beds ?? "?"} bd / ${l.baths ?? "?"} ba / ${l.sqft ?? "?"} sqft${l.sqft_source && l.sqft_source !== "MLS" ? ` [sqft ${l.sqft_source}]` : ""}
Taxes $${l.taxes ?? "?"}/yr | HOA ${l.hoa_monthly ? `$${l.hoa_monthly}/mo` : "none listed"} | Flood zone: ${l.flood_zone ?? "unknown"}${l.flood_sfha ? " (SPECIAL FLOOD HAZARD AREA)" : ""}
Remarks: ${l.remarks || "none"}
App signals: ${(l.signals ?? []).join("; ") || "none"} | Score ${l.score}
AI photo condition (ESTIMATE): ${l.condition_tier ?? "unknown"} — ${l.condition_notes ?? ""} | interior photos: ${l.has_interior ? "yes" : "no/unknown"} | ${(l.photo_urls ?? []).length} photos
Repair estimate (ESTIMATE): $${l.repairs_low ?? "?"}-$${l.repairs_high ?? "?"}${l.repairs_override != null ? ` (user set $${l.repairs_override})` : ""} | tier ranges: ${tiers}
ARV: ${l.arv ? `$${Number(l.arv).toLocaleString()}` : "none"}${l.arv_override ? " (user set)" : ""} | warnings: ${(l.arv_warnings ?? []).join("; ") || "none"}
Comps used:
${comps || "- none"}
App decision: ${l.action} | Offer $${l.offer_price ?? "?"} (${l.offer_formula ?? ""}) | reasons: ${(l.offer_reasons ?? []).join("; ") || "none"}
Current offer draft: ${o ? `${o.kind} $${o.price ?? "?"} (${o.status})` : "none"}
Listing agent: ${l.agent_name ?? "?"} | ${l.office_name ?? ""}
NJ tax record: ${tax ? `built ${tax.yearBuilt ?? "?"}, class ${tax.propClassLabel ?? "?"}, bldg code ${tax.buildingDesc ?? "?"}, assessed $${tax.netValue ?? "?"}, last transfer ${tax.lastSalePrice ?? "?"} on ${tax.lastSaleDate ?? "?"}, lot ${tax.acres ?? "?"} ac, owner mails to ${tax.ownerMailing ?? "?"}${tax.absenteeOwner ? " (absentee owner)" : ""}` : "not found"}`;
}

export async function askListing(id: number, question: string | null) {
  if (!process.env.GEMINI_API_KEY) throw new Error("AI key not set");
  if (!(await takeAiBudget("chat"))) throw new Error("Daily AI question limit reached — try again tomorrow");
  const ctx = await listingContext(id);
  const q = (question ?? "").trim() || VERDICT_PROMPT;
  const history = (await sql`select role, content from listing_chat where listing_id = ${id} order by id desc limit 12`).reverse();
  const contents = [
    { role: "user", parts: [{ text: `${SYSTEM}\n\nCURRENT DATA FOR THIS LISTING:\n${ctx}` }] },
    { role: "model", parts: [{ text: "Understood. I'll judge this listing from that data and say what's verified vs estimated." }] },
    ...history.map((h: any) => ({ role: h.role === "ai" ? "model" : "user", parts: [{ text: h.content }] })),
    { role: "user", parts: [{ text: q }] },
  ];
  const models = (process.env.GEMINI_MODELS ?? "gemini-3.5-flash,gemini-flash-latest").split(",");
  let answer = "";
  for (const model of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model.trim()}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
        // Google Search lets it answer neighborhood / market questions; it must still label web info as such.
        body: JSON.stringify({ contents, tools: [{ google_search: {} }], generationConfig: { temperature: 0.3 } }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      answer = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("").trim();
      if (answer) break;
    } catch { /* next model */ }
  }
  if (!answer) throw new Error("AI didn't answer — try again");
  await sql`insert into listing_chat ${sql([
    { listing_id: id, role: "user", content: question?.trim() ? question.trim() : "Give me your take on this deal." },
    { listing_id: id, role: "ai", content: answer },
  ])}`;
  return answer;
}
