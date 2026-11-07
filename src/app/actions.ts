"use server";
import { revalidatePath } from "next/cache";
import { sql } from "@/db";
import { analyzeListing, collabClient } from "@/lib/pipeline";

const SENDING_ENABLED = process.env.SENDING_ENABLED === "true";

export async function saveOffer(form: FormData) {
  const id = Number(form.get("id"));
  const price = Number(String(form.get("price") ?? "").replace(/[^0-9]/g, "")) || null;
  await sql`update offers set price = ${price}, to_email = ${String(form.get("to") ?? "") || null},
            subject = ${String(form.get("subject") ?? "")}, body = ${String(form.get("body") ?? "")} where id = ${id}`;
  revalidatePath(`/listing/${form.get("listing_id")}`);
}

export async function approveOffer(form: FormData) {
  await sql`update offers set status = 'approved' where id = ${Number(form.get("id"))} and status = 'draft'`;
  revalidatePath("/offers"); revalidatePath(`/listing/${form.get("listing_id")}`);
}

export async function rejectOffer(form: FormData) {
  await sql`update offers set status = 'rejected' where id = ${Number(form.get("id"))}`;
  revalidatePath("/offers"); revalidatePath(`/listing/${form.get("listing_id")}`);
}

/** Records that an offer went out (manual send, or automatic once SENDING_ENABLED). */
export async function markSent(form: FormData) {
  await sql`update offers set status = 'sent', sent_at = now() where id = ${Number(form.get("id"))}`;
  revalidatePath("/offers"); revalidatePath(`/listing/${form.get("listing_id")}`);
}

export async function sendOffer(form: FormData) {
  if (!SENDING_ENABLED) throw new Error("Sending is turned off until Google Workspace is ready.");
  // Gmail sending is wired in once Workspace is verified.
  throw new Error("Gmail sending not configured yet.");
}

export async function setSqft(form: FormData) {
  const id = Number(form.get("listing_id"));
  const sqft = Number(form.get("sqft")) || null;
  await sql`update listings set sqft = ${sqft}, analyzed_at = null where listing_id = ${id}`; // re-analyzed next scan
  revalidatePath(`/listing/${id}`);
}

export async function setType(form: FormData) {
  const id = Number(form.get("listing_id"));
  const type = String(form.get("type") ?? "sfr");
  const age55 = form.get("age55") === "1";
  await sql`update listings set property_type = ${type}, age55 = ${age55}, type_locked = true, analyzed_at = null where listing_id = ${id}`;
  revalidatePath(`/listing/${id}`); revalidatePath("/");
}

const num = (v: FormDataEntryValue | null) => { const n = Number(String(v ?? "").replace(/[^0-9]/g, "")); return String(v ?? "").trim() === "" || !Number.isFinite(n) ? null : n; };

/** Your numbers (ARV / repairs / sqft) -> re-price this listing right now and draft the offer. */
export async function setNumbers(form: FormData) {
  const id = Number(form.get("listing_id"));
  const arv = num(form.get("arv")), repairs = num(form.get("repairs")), sqft = num(form.get("sqft"));
  const compIds = form.has("comp_ids") ? String(form.get("comp_ids") ?? "").split(",").map(Number).filter(Boolean) : undefined;
  await sql`update listings set arv_override = ${arv}, repairs_override = ${repairs}${sqft ? sql`, sqft = ${sqft}` : sql``}${compIds ? sql`, user_comp_ids = ${compIds.length ? sql.json(compIds) : null}` : sql``} where listing_id = ${id}`;
  const [row] = await sql`select event from listings where listing_id = ${id}`;
  await analyzeListing(collabClient(), id, (row?.event as any) ?? "new", false, false);
  revalidatePath(`/listing/${id}`); revalidatePath("/"); revalidatePath("/offers");
}
