import { sql, migrate } from "@/db";
import { CollabClient } from "./ingest/collab";
import { computeArv } from "./comps";
import { decideOffer } from "./offer";
import { scoreListing } from "./score";
import { scanRemarks } from "./keywords";
import { floodZone } from "./flood";
import { assessPhotos } from "./photos";
import { push } from "./notify";
import { offerEmail, showingEmail } from "./emailDraft";
import { ALERTS, BUY_BOX } from "./config";
import { compUploadReminder } from "./reminders";
import type { Listing, PhotoAssessment, SoldComp } from "./types";

const DETAIL_PER_RUN = Number(process.env.DETAIL_PER_RUN ?? 25);
const PHOTOS_PER_RUN = Number(process.env.PHOTOS_PER_RUN ?? 6);

export function collabClient() {
  return new CollabClient({
    contactToken: process.env.COLLAB_CONTACT_TOKEN!,
    agentSite: process.env.COLLAB_AGENT_SITE ?? "nicholaspnickbrennan",
  });
}

/** Pick ~12 photos spread through the gallery (first ones are usually exterior). */
export function spreadPhotos(urls: string[], n = 12) {
  if (urls.length <= n) return urls;
  const out = urls.slice(0, 2);
  const step = (urls.length - 2) / (n - 2);
  for (let i = 0; i < n - 2; i++) out.push(urls[2 + Math.floor(i * step)]);
  return out;
}

export async function runScan(deadlineMs = Date.now() + 50_000) {
  await migrate();
  const [run] = await sql`insert into scan_runs default values returning id`;
  const c = collabClient();
  try {
    const rows = await c.allMatches();
    const existing = new Map<number, { list_price: number; status: string; analyzed_at: Date | null; event: string }>(
      (await sql`select listing_id, list_price, status, analyzed_at, event from listings`).map((r: any) => [Number(r.listing_id), r]),
    );

    const queue: { id: number; event: Listing["event"]; isNew: boolean }[] = [];
    let newCount = 0, changed = 0;
    for (const r of rows) {
      const id = Number(r.listingId);
      const status = String(r.statusDescription ?? "");
      if (/sold/i.test(r.statusCategoryDescription ?? "")) {
        await upsertSold(r); // sold matches feed the comp database
        continue;
      }
      const prev = existing.get(id);
      if (!prev) {
        newCount++;
        const event: Listing["event"] = /back on/i.test(status) ? "back_on_market" : "new";
        await sql`insert into listings ${sql({ listing_id: id, mls_number: String(r.mlsNumber), address: r.formattedFullAddressStreet ?? "", city: r.city, zip: r.zip, lat: r.latitude, lon: r.longitude, list_price: r.price, beds: Number(r.bedrooms) || null, status, event })} on conflict do nothing`;
        queue.push({ id, event, isNew: true });
      } else if (prev.list_price !== r.price || prev.status !== status) {
        changed++;
        const event: Listing["event"] = prev.list_price !== r.price ? "price_change" : /back on/i.test(status) ? "back_on_market" : "other";
        await sql`update listings set list_price = ${r.price}, status = ${status}, event = ${event}, last_changed = now(), analyzed_at = null where listing_id = ${id}`;
        queue.push({ id, event, isNew: false });
      } else if (!prev.analyzed_at) {
        queue.push({ id, event: (prev.event as Listing["event"]) ?? "new", isNew: false }); // backlog from earlier runs
      }
    }
    // Remove listings no longer matched (sold/withdrawn off the search) from view
    const live = rows.map((r: any) => Number(r.listingId));
    if (live.length) await sql`update listings set hidden = true where listing_id <> all(${live}) and hidden = false`;

    // Sold comps queued from an uploaded MLS export: fetch full details (fast, no AI).
    const compsLoaded = await processCompQueue(c, deadlineMs - 25_000);
    const [{ left }] = await sql`select count(*)::int as left from comp_queue where done_at is null`;
    if (compsLoaded > 0 && left === 0) {
      // Upload fully imported -> re-price listings that had no ARV, once (photo reads are reused, not re-run).
      await sql`update listings set analyzed_at = null where arv is null and hidden = false and analyzed_at is not null`;
    }

    // newest/changed first, then backlog
    queue.sort((a, b) => Number(b.isNew || b.event !== "new") - Number(a.isNew || a.event !== "new"));
    let analyzed = 0, photosUsed = 0;
    for (const q of queue.slice(0, DETAIL_PER_RUN)) {
      if (Date.now() > deadlineMs) break;
      const usedPhotos = await analyzeListing(c, q.id, q.event, photosUsed < PHOTOS_PER_RUN, q.isNew);
      if (usedPhotos) photosUsed++;
      analyzed++;
    }
    await compUploadReminder().catch(() => {});
    await sql`update scan_runs set finished_at = now(), matches = ${rows.length}, new_count = ${newCount}, changed_count = ${changed}, analyzed = ${analyzed} where id = ${run.id}`;
    return { matches: rows.length, newCount, changed, analyzed, backlog: Math.max(0, queue.length - analyzed) };
  } catch (e: any) {
    await sql`update scan_runs set finished_at = now(), error = ${String(e?.message ?? e)} where id = ${run.id}`;
    throw e;
  }
}

export async function processCompQueue(c: CollabClient, deadlineMs: number, max = 60) {
  const ids = (await sql`select listing_id from comp_queue where done_at is null order by added_at limit ${max}`).map((r: any) => Number(r.listing_id));
  let loaded = 0;
  for (let i = 0; i < ids.length; i += 6) {
    if (Date.now() > deadlineMs) break;
    await Promise.all(ids.slice(i, i + 6).map(async (id) => {
      try {
        const L = await c.fullListing(id, "sold");
        const salePrice = (L.raw.soldPrice as number | undefined) ?? L.listPrice;
        if (L.propertyType !== "other" && L.lat != null && salePrice) {
          await sql`insert into sold_comps ${sql({
            listing_id: id, address: `${L.address}, ${L.city}`, lat: L.lat, lon: L.lon, beds: L.beds ?? null, sqft: L.sqft ?? null,
            property_type: L.propertyType, sale_price: salePrice, close_date: (L.raw.closeDate as string | undefined) ?? null, remarks: L.remarks,
          })} on conflict (listing_id) do update set sale_price = excluded.sale_price, close_date = excluded.close_date, sqft = excluded.sqft, beds = excluded.beds, remarks = excluded.remarks`;
          loaded++;
        }
        await sql`update comp_queue set done_at = now(), error = null where listing_id = ${id}`;
      } catch (e: any) {
        await sql`update comp_queue set done_at = now(), error = ${String(e?.message ?? e).slice(0, 200)} where listing_id = ${id}`;
      }
    }));
  }
  return loaded;
}

async function upsertSold(r: any) {
  await sql`insert into sold_comps ${sql({
    listing_id: Number(r.listingId), address: r.formattedFullAddress, lat: r.latitude, lon: r.longitude,
    beds: Number(r.bedrooms) || null, sale_price: r.price, close_date: r.priceDate?.slice(0, 10) ?? null,
  })} on conflict (listing_id) do update set sale_price = excluded.sale_price, close_date = excluded.close_date`;
}

async function loadComps(): Promise<SoldComp[]> {
  const rows = await sql`select * from sold_comps where lat is not null and sqft is not null and sale_price is not null`;
  return rows.map((r: any) => ({
    address: r.address, lat: r.lat, lon: r.lon, beds: Number(r.beds), sqft: r.sqft,
    propertyType: r.property_type ?? "sfr", salePrice: r.sale_price, closeDate: String(r.close_date), remarks: r.remarks ?? "",
  }));
}

/** Full analysis of one listing. Returns true if photo AI was used. */
export async function analyzeListing(c: CollabClient, id: number, event: Listing["event"], allowPhotos: boolean, isNew: boolean) {
  const L = await c.fullListing(id, event);
  const flood = L.lat != null && L.lon != null ? await floodZone(L.lat, L.lon) : { zone: null, sfha: null };
  const arvRes = computeArv(L, await loadComps());

  // Photo AI only on listings worth a look (saves cost): keywords, price cut, BOM, long DOM, or list well under ARV.
  const kw = scanRemarks(L.remarks);
  const worthPhotos =
    L.listPrice <= BUY_BOX.maxListPrice && L.propertyType !== "other" && L.propertyType !== "land" &&
    (kw.score >= 2 || event === "price_change" || event === "back_on_market" || (L.dom ?? 0) >= 60 ||
      (arvRes.arv != null && L.listPrice <= arvRes.arv * 0.85));
  let photo: PhotoAssessment = { tier: "unknown", hasInterior: false, confidence: 0, notes: worthPhotos ? "Photo check pending" : "Not screened (no distress signals)" };
  let used = false;
  // Reuse an earlier photo read (re-pricing after new comps shouldn't pay for AI again).
  const [prior] = await sql`select condition_tier, condition_notes, has_interior from listings where listing_id = ${id}`;
  const havePrior = prior?.condition_tier && prior.condition_tier !== "unknown";
  if (havePrior) {
    photo = { tier: prior.condition_tier, hasInterior: !!prior.has_interior, confidence: 0.8, notes: prior.condition_notes ?? "" };
  } else if (worthPhotos && allowPhotos) {
    photo = await assessPhotos(spreadPhotos(L.photoUrls));
    used = true;
  }

  const sc = scoreListing(L, arvRes.arv);
  const dec = decideOffer(L, arvRes.arv, photo, flood);
  // Guardrails: no shotgun offers on ordinary listings, and no offers on shaky ARVs.
  if ((dec.action === "offer" || dec.action === "showing_request") && arvRes.warnings.some((w) => /unreliable|disagree/i.test(w))) {
    dec.action = "needs_data";
    dec.reasons.push("ARV not reliable — check the comps before offering");
  } else if ((dec.action === "offer" || dec.action === "showing_request") && !worthPhotos) {
    dec.action = "skip";
    dec.reasons.push("No distress signals and not priced below ARV — watching for a price drop");
  }
  if (flood.sfha) sc.signals.push(`Flood zone ${flood.zone}`);

  await sql`update listings set ${sql({
    address: L.address, city: L.city, zip: L.zip ?? null, lat: L.lat ?? null, lon: L.lon ?? null,
    list_price: L.listPrice, original_price: L.originalListPrice ?? null, beds: L.beds ?? null, baths: L.baths ?? null,
    sqft: L.sqft ?? null, property_type: L.propertyType, subtype: String(L.raw.subtype ?? ""), remarks: L.remarks,
    dom: L.dom ?? null, hoa_monthly: L.hoaMonthly ?? null, taxes: Number(L.raw.taxes) || null,
    agent_name: L.agentName ?? null, agent_email: L.agentEmail ?? null, agent_phone: L.agentPhone ?? null,
    office_name: String(L.raw.office ?? ""), photo_urls: sql.json(L.photoUrls), event,
    keyword_hits: sql.json(sc.keywordHits), signals: sql.json(sc.signals), score: sc.score,
    arv: arvRes.arv, arv_comps: sql.json(arvRes.comps as any), arv_warnings: sql.json(arvRes.warnings),
    ...(used || (!worthPhotos && !havePrior) ? { condition_tier: photo.tier, condition_notes: photo.notes, has_interior: photo.hasInterior } : {}),
    repairs_low: dec.repairsLow, repairs_high: dec.repairsHigh, flood_zone: flood.zone, flood_sfha: flood.sfha,
    action: dec.action, offer_price: dec.offer, offer_formula: dec.formula, offer_reasons: sql.json(dec.reasons),
    analyzed_at: new Date(),
  })} where listing_id = ${id}`;

  // Draft (never send) an offer / showing request if none exists yet.
  if (dec.action === "offer" || dec.action === "showing_request") {
    const [has] = await sql`select 1 from offers where listing_id = ${id} and status <> 'rejected' limit 1`;
    if (!has) {
      const meta = { address: L.address, city: L.city, mls_number: L.mlsNumber, agent_name: L.agentName ?? null };
      const e = dec.action === "offer" ? offerEmail(meta, dec.offer!) : showingEmail(meta);
      await sql`insert into offers ${sql({ listing_id: id, kind: dec.action, price: dec.offer, to_email: L.agentEmail ?? null, subject: e.subject, body: e.body })}`;
    }
  }

  if (isNew && sc.score >= ALERTS.hotDealMinScore) {
    await push(`Hot deal (${sc.score}): ${L.address}`, `${L.city} | $${L.listPrice.toLocaleString()} | ${sc.signals.slice(0, 3).join("; ")}`, { priority: 5, tags: "house" });
  }
  return used;
}
