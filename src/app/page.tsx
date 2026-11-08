import Link from "next/link";
import { sql, migrate } from "@/db";
import { Header, Score, ActionPill, money, ago } from "./ui";

export const dynamic = "force-dynamic";

const SORTS: Record<string, string> = {
  best: "score desc, first_seen desc",
  newest: "first_seen desc",
  pricecut: "(coalesce(original_price, list_price) - list_price)::float / nullif(coalesce(original_price, list_price), 0) desc nulls last, score desc",
  cheapest: "list_price asc",
  spread: "(arv - list_price) desc nulls last",
};

export default async function Listings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await migrate();
  const sp = await searchParams;
  const sort = SORTS[sp.sort ?? "best"] ? sp.sort ?? "best" : "best";
  const action = sp.action ?? "";
  const q = (sp.q ?? "").trim();
  const minScore = Number(sp.min ?? 0) || 0;

  const rows = await sql`
    select listing_id, mls_number, address, city, list_price, original_price, beds, baths, sqft, arv, repairs_high,
           offer_price, score, action, condition_tier, flood_zone, flood_sfha, first_seen, event, keyword_hits, property_type, age55, analyzed_at
    from listings
    where hidden = false
      ${action ? sql`and action = ${action}` : sql``}
      ${minScore ? sql`and score >= ${minScore}` : sql``}
      ${q ? sql`and (address ilike ${"%" + q + "%"} or city ilike ${"%" + q + "%"} or mls_number = ${q} or agent_name ilike ${"%" + q + "%"})` : sql``}
    order by ${sql.unsafe(SORTS[sort])}
    limit 300`;

  const [k] = await sql`
    select count(*) filter (where hidden = false) total,
           count(*) filter (where hidden = false and dom is not null and dom <= 1) new24,
           count(*) filter (where hidden = false and score >= 70) hot,
           count(*) filter (where hidden = false and action = 'offer') ready,
           count(*) filter (where hidden = false and analyzed_at is null) backlog,
           (select count(*) from sold_comps) comps,
           (select max(finished_at) from scan_runs where error is null and matches is not null) last_scan
    from listings`;

  return (
    <div className="wrap">
      <Header tab="listings" />
      <div className="kpis">
        <div className="kpi"><b>{k.total}</b><span>Active matches</span></div>
        <div className="kpi"><b>{k.new24}</b><span>Listed in last 24h</span></div>
        <div className="kpi"><b>{k.hot}</b><span>Hot (score 70+)</span></div>
        <div className="kpi"><b>{k.ready}</b><span>Offer ready</span></div>
        <div className="kpi"><b>{k.comps}</b><span>Sold comps on file</span></div>
        <div className="kpi"><b>{k.backlog}</b><span>Waiting for analysis · last scan {ago(k.last_scan)}</span></div>
      </div>
      {Number(k.comps) === 0 && <p className="note">No sold comps yet, so ARV and offers can't be calculated. Add the "Sold" saved search in Paragon to fix this. Ranking below uses keywords, price cuts and days on market.</p>}

      <form className="filters">
        <select name="sort" defaultValue={sort}>
          <option value="best">Best deal first</option>
          <option value="newest">Newest first</option>
          <option value="pricecut">Biggest price cut</option>
          <option value="spread">Biggest ARV spread</option>
          <option value="cheapest">Lowest price</option>
        </select>
        <select name="action" defaultValue={action}>
          <option value="">All statuses</option>
          <option value="offer">Offer ready</option>
          <option value="showing_request">See in person</option>
          <option value="needs_data">Needs comps/sqft</option>
          <option value="skip">Skip</option>
        </select>
        <select name="min" defaultValue={String(minScore)}>
          <option value="0">Any score</option>
          <option value="20">Score 20+</option>
          <option value="40">Score 40+</option>
          <option value="70">Score 70+</option>
        </select>
        <input type="search" name="q" placeholder="Search address, town, agent, MLS #" defaultValue={q} />
        <button type="submit">Apply</button>
      </form>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Score</th><th>Address</th><th className="num">List</th><th className="num">Sqft</th><th className="num">ARV</th>
              <th className="num">Repairs</th><th className="num">Offer</th><th>Condition</th><th>Flood</th><th>Signals</th><th>Status</th><th>Added</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => {
              const cut = r.original_price && r.original_price > r.list_price ? Math.round((1 - r.list_price / r.original_price) * 100) : 0;
              return (
                <tr key={r.listing_id}>
                  <td><Score v={r.score ?? 0} /></td>
                  <td><Link href={`/listing/${r.listing_id}`}>{r.address}</Link><div className="sub">{r.city} · {r.beds ?? "?"}bd {r.baths ?? "?"}ba · {r.property_type}{r.age55 ? " · 55+" : ""}</div></td>
                  <td className="num">{money(r.list_price)}{cut > 0 && <div className="sub">−{cut}%</div>}</td>
                  <td className="num">{r.sqft ?? "—"}</td>
                  <td className="num">{money(r.arv)}</td>
                  <td className="num">{money(r.repairs_high)}</td>
                  <td className="num"><b>{money(r.offer_price)}</b></td>
                  <td>{r.condition_tier && r.condition_tier !== "unknown" ? r.condition_tier : "—"}</td>
                  <td>{r.flood_sfha ? <span className="pill bad">{r.flood_zone}</span> : r.flood_zone ?? "?"}</td>
                  <td className="sub">{(r.keyword_hits ?? []).slice(0, 3).join(", ")}{r.event === "back_on_market" ? " · back on mkt" : ""}</td>
                  <td>{r.analyzed_at ? <ActionPill a={r.action} /> : <span className="pill">Queued</span>}</td>
                  <td className="sub">{ago(r.first_seen)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
