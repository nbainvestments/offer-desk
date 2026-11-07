// Finds living-area sqft for an address via Gemini + Google Search grounding (Google does the searching;
// we never scrape Zillow). Answers are sanity-checked and stored with their source so you can judge them.
export interface SqftResult { sqft: number | null; source: string | null; note: string }

export async function lookupSqftOnline(address: string, beds?: number | null, baths?: number | null): Promise<SqftResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { sqft: null, source: null, note: "no AI key" };
  const prompt = `Search the web for the finished living area (square feet) of this house: ${address}, New Jersey.
${beds ? `It has ${beds} bedrooms${baths ? ` and ${baths} bathrooms` : ""}.` : ""}
Use listing/record sites (Zillow, Redfin, Realtor.com, Homes.com, county/tax records). Use living area, NOT lot size.
If sources disagree, use the most common value. If you can't find this exact address, say so — do not guess.
Reply ONLY with JSON: {"sqft": number or null, "source": "site name", "matched_address": "address as shown on the source"}`;
  const models = (process.env.GEMINI_SEARCH_MODELS ?? "gemini-3.5-flash,gemini-flash-latest").split(",");
  for (const model of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model.trim()}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0 } }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      const text: string = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) continue;
      const o = JSON.parse(m[0]);
      const sqft = Number(o.sqft);
      // Sanity: real living area, and the source must be the same house number.
      const houseNo = address.trim().match(/^\d+/)?.[0];
      const sameHouse = !houseNo || !o.matched_address || String(o.matched_address).trim().startsWith(houseNo);
      if (!Number.isFinite(sqft) || sqft < 400 || sqft > 8000 || !sameHouse) return { sqft: null, source: o.source ?? null, note: "not found / failed checks" };
      return { sqft: Math.round(sqft), source: String(o.source ?? "web"), note: "ok" };
    } catch { /* next model */ }
  }
  return { sqft: null, source: null, note: "lookup failed" };
}
