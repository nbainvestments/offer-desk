import { sql } from "@/db";

// Daily caps so AI spend can't run away. Adjustable via env.
const CAPS: Record<string, number> = {
  photo: Number(process.env.AI_DAILY_PHOTO_CAP ?? 150),   // photo condition reads
  search: Number(process.env.AI_DAILY_SEARCH_CAP ?? 400), // web sqft lookups
};

/** Reserve one call of `kind` for today; false when today's cap is used up. */
export async function takeAiBudget(kind: "photo" | "search"): Promise<boolean> {
  const [r] = await sql`
    insert into ai_usage (day, kind, n) values (current_date, ${kind}, 1)
    on conflict (day, kind) do update set n = ai_usage.n + 1
    returning n`;
  return Number(r.n) <= CAPS[kind];
}
