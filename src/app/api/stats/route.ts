import { NextResponse } from "next/server";
import { sql, migrate } from "@/db";

export const dynamic = "force-dynamic";

// Diagnostics: why listings are stuck. Authorization: Bearer CRON_SECRET
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await migrate();
  const [comps] = await sql`select count(*)::int total, count(*) filter (where close_date >= now() - interval '90 days')::int last90,
    count(*) filter (where close_date >= now() - interval '180 days')::int last180, count(sqft)::int with_sqft,
    (select count(*)::int from comp_queue where done_at is null) queued from sold_comps`;
  const actions = await sql`select coalesce(action, 'not analyzed') action, count(*)::int n from listings where hidden = false group by 1 order by 2 desc`;
  const stuck = await sql`
    select case
      when analyzed_at is null then 'waiting for analysis'
      when sqft is null then 'no sqft'
      when property_type in ('condo','multi','mobile','land') then 'type ' || property_type || ' (few/no comps of that type)'
      when arv_warnings::text ilike '%unreliable%' or arv_warnings::text ilike '%disagree%' or offer_reasons::text ilike '%not reliable%' then 'comps too far apart'
      when arv_warnings::text ilike '%fewer than%' then 'fewer than 3 matching comps'
      else 'other' end reason, count(*)::int n
    from listings where hidden = false and (action = 'needs_data' or analyzed_at is null) group by 1 order by 2 desc`;
  const byType = await sql`select property_type, age55, count(*)::int n, count(*) filter (where action = 'needs_data')::int stuck from listings where hidden = false group by 1,2 order by 3 desc`;
  const scans = await sql`select started_at, finished_at, matches, analyzed, error from scan_runs where matches is not null or error is not null order by id desc limit 5`;
  return NextResponse.json({ comps, actions, stuck, byType, scans });
}
