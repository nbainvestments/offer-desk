import type { PhotoAssessment } from "./types";

// Provider-agnostic: Gemini by default. Swap AI_PROVIDER to change without touching callers.
const PROMPT = `You are a residential rehab estimator in South Jersey. Look at these listing photos.
Classify overall condition into exactly one tier:
- turnkey: move-in ready, recently updated
- cosmetic: paint, flooring, fixtures; kitchen/baths usable
- moderate: kitchen and/or baths need replacing, some systems dated
- heavy: kitchen + baths + flooring + likely systems (roof/HVAC/electric) or visible damage
- gut: down to studs, fire/water/mold damage, structural issues, uninhabitable
Say whether any INTERIOR photos exist. Be conservative: if unsure between two tiers, pick the worse one.
Reply ONLY with JSON: {"tier":"...","hasInterior":true|false,"confidence":0-1,"notes":"one sentence on what you saw"}`;

export async function assessPhotos(urls: string[], maxPhotos = 12): Promise<PhotoAssessment> {
  if (!urls.length) return { tier: "unknown", hasInterior: false, confidence: 0, notes: "No photos" };
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { tier: "unknown", hasInterior: false, confidence: 0, notes: "AI key not set" };

  const images = await Promise.all(
    urls.slice(0, maxPhotos).map(async (u) => {
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(10_000) });
        if (!r.ok) return null;
        const buf = Buffer.from(await r.arrayBuffer());
        return { inline_data: { mime_type: r.headers.get("content-type") ?? "image/jpeg", data: buf.toString("base64") } };
      } catch { return null; }
    }),
  );
  const parts = [{ text: PROMPT }, ...images.filter(Boolean)];
  // Try models in order; retry overloaded (429/503) with backoff before falling to the next.
  const models = (process.env.GEMINI_MODELS ?? "gemini-3.5-flash,gemini-flash-latest,gemini-3.5-flash-lite").split(",");
  let r: Response | null = null;
  let lastErr = "";
  outer: for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model.trim()}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }),
          signal: AbortSignal.timeout(60_000),
        });
        if (r.ok) break outer;
        lastErr = `${model} ${r.status}`;
        if (r.status !== 429 && r.status !== 503) continue outer;
      } catch (e) { lastErr = `${model} timeout`; }
      await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
    }
  }
  if (!r?.ok) return { tier: "unknown", hasInterior: false, confidence: 0, notes: `AI error ${lastErr}` };
  try {
    const txt = (await r.json()).candidates[0].content.parts[0].text;
    const j = JSON.parse(txt);
    return { tier: j.tier, hasInterior: !!j.hasInterior, confidence: Number(j.confidence) || 0, notes: String(j.notes ?? "") };
  } catch {
    return { tier: "unknown", hasInterior: false, confidence: 0, notes: "Could not parse AI reply" };
  }
}
