// Client for the agent's Paragon Collaboration Center portal (SJSR).
// Reads the saved-search matches the agent set up for us: same data the portal shows on screen.
import type { Listing, PropertyType } from "../types";

const BASE = "https://sjsr.paragonrels.com/inferno";
const APP_ID = "3d14a9a79912e";

export interface CollabCfg { contactToken: string; agentSite: string }

export class CollabClient {
  private token: string | null = null;
  private tokenExp = 0;
  private contactId: number | null = null;
  constructor(private cfg: CollabCfg) {}

  private async auth() {
    if (this.token && Date.now() < this.tokenExp - 60_000) return;
    const r = await fetch(`${BASE}/user/auth/contact`, {
      method: "POST",
      headers: { "inferno-app-id": APP_ID, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ contactToken: this.cfg.contactToken, agentSite: this.cfg.agentSite, isAgent: false }),
    });
    const j = await r.json();
    if (!j.isSuccess || !j.data) throw new Error("Collab login failed — contact token may be revoked");
    this.token = j.data as string;
    const payload = JSON.parse(Buffer.from(this.token.split(".")[1], "base64url").toString());
    this.tokenExp = payload.exp * 1000;
    this.contactId = Number(payload.contactid);
  }

  async call<T = any>(path: string, body?: unknown): Promise<T> {
    await this.auth();
    const r = await fetch(`${BASE}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${this.token}`, "inferno-app-id": APP_ID, "inferno-mls-id": "SJSR",
        accept: "application/json", "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const re = r.headers.get("x-reissued-token");
    if (re) this.token = re;
    if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
    const j = await r.json();
    if (!j.isSuccess) throw new Error(`${path} -> ${JSON.stringify(j.messages ?? j).slice(0, 200)}`);
    return j.data as T;
  }

  /** All saved-search matches (summary rows). */
  async allMatches(pageSize = 100): Promise<any[]> {
    await this.auth();
    const out: any[] = [];
    for (let page = 1; ; page++) {
      const d = await this.call(`/contact/listingsbyactivity/${this.contactId}?activityViewCategory=1&inc=2892`, {
        page, limit: pageSize, sort: "440010630", order: "asc",
      });
      out.push(...d.data);
      if (page >= d.totalPages) break;
    }
    return out;
  }

  /** IDs changed in the last N days: new, price change, status change. */
  async changes(daysBack = 1) {
    return this.call<{ newListingIds: number[]; priceChangeListingIds: number[]; statusChangeListingIds: number[] }>(
      `/contact/matchupdates?daysBack=${daysBack}`,
    );
  }

  async report(listingId: number) { return this.call(`/listingreport/report/${listingId}/85?inc=allwithnomedia`); }
  async media(listingId: number) { return this.call<{ photos: { iu: string; lu: string }[] }>(`/listingmedia/${listingId}`); }

  /** Full normalized listing: remarks, sqft, photos, agent contact. */
  async fullListing(listingId: number, event: Listing["event"] = "new"): Promise<Listing & { raw: Record<string, unknown> }> {
    const [rep, med] = await Promise.all([this.report(listingId), this.media(listingId).catch(() => ({ photos: [] }))]);
    return normalizeReport(rep, med.photos.map((p) => p.lu), event);
  }
}

// --- normalization -------------------------------------------------------
const FC = {
  price: 130010000, mls: 130010001, type: 130010003, address: 130010006, city: 130010008, zip: 130010010,
  status: 130010011, beds: 130010014, fullBaths: 130010015, halfBaths: 130010016, sqft: 120010178,
  listDate: 130010033, origPrice: 130010035, hoa: 120010179, taxes: 120010183, offMktDays: 130010480,
  remarks: 540010551, soldPrice: 130010045, closeDate: 130010044, age: 800010104, basement: 800010004, yearBuilt: 120010018,
} as const;

function fieldMap(fields: any[]) {
  const m = new Map<number, { de?: string; v: any }>();
  for (const f of fields ?? []) {
    const dv = f.dataValue ?? {};
    let v = dv.dv ?? dv.da;
    if (Array.isArray(v)) v = v.map((x: any) => (typeof x === "object" ? x.dv ?? x.da : x));
    m.set(f.field?.fc, { de: f.de, v });
  }
  return m;
}

function typeOf(subtype: string): PropertyType {
  const s = (subtype ?? "").toLowerCase();
  if (/mobile|manufactured/.test(s)) return "other"; // mobile homes: no land, lot rent — not a flip comp
  if (/condo/.test(s)) return "condo";
  if (/town|twin|row/.test(s)) return "townhouse";
  if (/duplex|2 family|3 family|4 family|multi|2-4/.test(s)) return "multi";
  if (/land|lot/.test(s)) return "land";
  if (/single|detached|cape|ranch|colonial|bi-level|split/.test(s)) return "sfr";
  return "other";
}

const num = (v: any) => { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) && n > 0 ? n : undefined; };

export function normalizeReport(rep: any, photoUrls: string[], event: Listing["event"]) {
  const L = rep.listing;
  const f = fieldMap(L.fields);
  const g = (k: keyof typeof FC) => f.get(FC[k])?.v;
  const agent = L.agents?.find((a: any) => a.key === 1)?.value ?? L.agents?.[0]?.value;
  const office = L.offices?.[0]?.value;
  const full = num(g("fullBaths")) ?? 0, half = num(g("halfBaths")) ?? 0;
  const listing: Listing & { raw: Record<string, unknown> } = {
    mlsNumber: String(g("mls")),
    address: String(g("address") ?? ""),
    city: String(f.get(FC.city)?.de ?? g("city") ?? ""),
    zip: g("zip") ? String(g("zip")) : undefined,
    lat: L.latitude ?? undefined, lon: L.longitude ?? undefined,
    listPrice: num(g("price")) ?? 0,
    originalListPrice: num(g("origPrice")),
    beds: num(g("beds")),
    baths: full + 0.5 * half || undefined,
    sqft: saneSqft(num(g("sqft")), num(g("beds"))) ?? sqftFromRemarks(String(g("remarks") ?? "")),
    propertyType: typeOf(String(g("type") ?? "")),
    remarks: String(g("remarks") ?? ""),
    dom: g("listDate") ? Math.max(0, Math.floor((Date.now() - new Date(String(g("listDate"))).getTime()) / 86_400_000)) : undefined,
    listDate: g("listDate") ? String(g("listDate")) : undefined,
    event,
    agentName: agent?.formattedFullName,
    agentEmail: agent?.emailAddress,
    agentPhone: agent?.phoneNumbers?.[0]?.formattedPhone ?? agent?.mobilePhoneNumber,
    hoaMonthly: num(g("hoa")),
    photoUrls,
    raw: {
      subtype: g("type"), status: g("status"), taxes: g("taxes"), age: g("age"),
      office: office?.name, officePhone: office?.phoneNumbers?.[0]?.formattedPhone,
      soldPrice: num(g("soldPrice")), closeDate: g("closeDate") ? String(g("closeDate")).slice(0, 10) : undefined,
    },
  };
  return listing;
}

/** Agents often skip the SqFt field but mention it in remarks: "1,850 sq ft", "2100 sqft", "1,400 square feet". */
export function sqftFromRemarks(remarks: string): number | undefined {
  const m = remarks.match(/(\d{1,2},?\d{3})\s*(?:\+\s*)?(?:sq\.?\s*ft|sqft|square\s*f(?:ee|oo)t|sf\b)/i);
  const n = m ? Number(m[1].replace(",", "")) : NaN;
  return n >= 400 && n <= 10000 ? n : undefined;
}

/** Reject obvious agent typos (lot size entered as living area, etc.). */
function saneSqft(sqft?: number, beds?: number) {
  if (!sqft) return undefined;
  if (sqft < 300) return undefined;
  if (sqft > 6000 && (beds ?? 0) <= 4) return undefined;
  return sqft;
}
