import { sql } from "@/db";
import { push } from "./notify";

const DASH = process.env.DASHBOARD_URL ?? "https://offer-desk-eta.vercel.app";
export const COMP_UPLOAD_EVERY_DAYS = Number(process.env.COMP_UPLOAD_EVERY_DAYS ?? 30);

/** Once a day (9am ET hour), remind to upload a fresh 90-day sold export when the last one is stale. */
export async function compUploadReminder() {
  const hourET = Number(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
  if (hourET !== 9) return;
  const [r] = await sql`select max(added_at) last_upload, (select max(started_at) from scan_runs where error = 'reminder:comps') last_reminded from comp_queue`;
  const days = r.last_upload ? (Date.now() - new Date(r.last_upload).getTime()) / 86_400_000 : 999;
  if (days < COMP_UPLOAD_EVERY_DAYS) return;
  if (r.last_reminded && Date.now() - new Date(r.last_reminded).getTime() < 20 * 3_600_000) return;
  await push(
    "Upload new sold comps",
    `Last upload was ${Math.floor(days)} days ago. Ask Nick for a Paragon SOLD export: last 90 days, Atlantic County, Residential. ` +
      `Columns: MLS # (required), Address, Price, Area, Type, Status. In Numbers: File > Export To > CSV. ` +
      `Then Offer Desk > Comps tab > Upload.`,
    { priority: 4, tags: "calendar", url: `${DASH}/comps` },
  );
  await sql`insert into scan_runs (finished_at, error) values (now(), 'reminder:comps')`;
}
