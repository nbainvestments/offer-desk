import * as cheerio from "cheerio";
import type { Listing, PropertyType } from "../types";

// Parses SJSR Paragon "Activity notification for your Collaboration Center Site" emails.
// The email carries only a preview (address, MLS#, type, price, beds, baths, event).
// Remarks, sqft, photos and listing agent live behind detailUrl.

export interface AlertListing extends Partial<Listing> {
  mlsNumber: string;
  address: string;
  city: string;
  zip?: string;
  listPrice: number;
  propertyType: PropertyType;
  event: Listing["event"];
  statusText: string;
  detailUrl?: string;
  searchName?: string;
}

const EVENT_MAP: [RegExp, Listing["event"]][] = [
  [/back on market|back on/i, "back_on_market"],
  [/price/i, "price_change"],
  [/sold|closed/i, "sold"],
  [/expired/i, "expired"],
  [/withdrawn|cancel/i, "withdrawn"],
  [/^new$/i, "new"],
];

function typeOf(t: string): PropertyType {
  const s = t.toLowerCase();
  if (s.includes("single")) return "sfr";
  if (s.includes("condo")) return "condo";
  if (s.includes("town")) return "townhouse";
  if (/multi|duplex|triplex|2-4|two|three|four/.test(s)) return "multi";
  if (/land|lot/.test(s)) return "land";
  return "other";
}

const money = (s: string) => Number(s.replace(/[^0-9.]/g, "")) || 0;

export function parseParagonAlert(html: string): AlertListing[] {
  const $ = cheerio.load(html);
  const detailLinks = $("a")
    .filter((_, a) => $(a).text().trim() === "View This Listing")
    .map((_, a) => $(a).attr("href"))
    .get();

  const lines = $("body").text().split(/\n/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  const searchName = lines[lines.indexOf("COLLABORATION CENTER UPDATES") + 1];

  const out: AlertListing[] = [];
  let k = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== "View This Listing") continue;
    const eventText = lines[i - 2] ?? "";
    const statusText = lines[i - 1] ?? "";
    const address = lines[i + 1];
    const cityLine = lines[i + 2] ?? "";
    const m = cityLine.match(/^(.*?),\s*([A-Z]{2})\s+(\d{5})/);
    const mlsIdx = lines.indexOf("MLS #", i);
    const mlsNumber = lines[mlsIdx + 1];
    const typeText = lines[mlsIdx + 2] ?? "";
    // price: first $ amount after MLS#; a price change may show two (old, new) — take the last before labels
    const prices: number[] = [];
    let j = mlsIdx + 3;
    while (j < lines.length && /^\$[\d,]+/.test(lines[j])) prices.push(money(lines[j++]));
    const fields: Record<string, string> = {};
    for (; j < lines.length && lines[j] !== "View This Listing" && !/^View \d+ Updates?$/.test(lines[j]); j++) {
      if (lines[j].endsWith(":")) fields[lines[j].slice(0, -1)] = lines[j + 1];
    }
    const event = EVENT_MAP.find(([re]) => re.test(eventText))?.[1] ?? (/back on/i.test(searchName ?? "") ? "back_on_market" : "other");
    out.push({
      mlsNumber, address, city: m?.[1] ?? cityLine, zip: m?.[3],
      listPrice: prices.at(-1) ?? 0,
      originalListPrice: prices.length > 1 ? prices[0] : undefined,
      beds: fields["Bedrooms"] ? Number(fields["Bedrooms"]) : undefined,
      baths: (Number(fields["Full Baths"] ?? 0) + 0.5 * Number(fields["Half Baths"] ?? 0)) || undefined,
      propertyType: typeOf(typeText), event, statusText,
      detailUrl: detailLinks[k++], searchName, photoUrls: [], remarks: "",
    });
  }
  return out;
}
