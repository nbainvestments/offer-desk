import { KEYWORDS } from "./config";

export interface KeywordResult {
  hits: string[];
  score: number; // sum of weights, de-duplicated by overlapping phrases
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function scanRemarks(remarks: string): KeywordResult {
  const text = ` ${remarks.toLowerCase().replace(/\s+/g, " ")} `;
  // longest phrases first so "sold as is" wins over "as is"
  const phrases = Object.keys(KEYWORDS).sort((a, b) => b.length - a.length);
  let remaining = text;
  const hits: string[] = [];
  let score = 0;
  for (const p of phrases) {
    const re = new RegExp(`(?<![a-z0-9])${escape(p)}(?![a-z0-9])`, "g");
    if (re.test(remaining)) {
      hits.push(p);
      score += KEYWORDS[p];
      remaining = remaining.replace(re, " ");
    }
  }
  return { hits, score };
}

export function containsAny(text: string | undefined, words: string[]): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return words.some((w) => new RegExp(`(?<![a-z0-9])${escape(w)}(?![a-z0-9])`).test(t));
}
