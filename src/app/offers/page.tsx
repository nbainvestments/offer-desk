import Link from "next/link";
import { sql, migrate } from "@/db";
import { Header, Score, OfferStatus, money, pct, ago } from "../ui";

export const dynamic = "force-dynamic";

const VIEWS: Record<string, { label: string; where: string }> = {
  sent: { label: "Sent", where: "o.status in ('sent','replied')" },
  drafts: { label: "Drafts", where: "o.status in ('draft','approved')" },
  all: { label: "All", where: "o.status <> 'rejected'" },
};
const SORTS: Record<string, { label: string; order: string }> = {
  recent: { label: "Most recently sent", order: "o.sent_at desc nulls last, o.created_at desc" },
  best: { label: "Best deal first", order: "l.score desc, (l.arv - o.price) desc nulls last" },
  spread: { label: "Biggest spread (ARV − offer)", order: "(l.arv - o.price) desc nulls last" },
  oldest: { label: "Oldest sent (follow up)", order: "o.sent_at asc nulls last" },
};

export default async function Offers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await migrate();
  const sp = await searchParams;
  const view = VIEWS[sp.view ?? "sent"] ? sp.view ?? "sent" : "sent";
  const sort = SORTS[sp.sort ?? "recent"] ? sp.sort ?? "recent" : "recent";

  const rows = await sql`
    select o.id, o.kind, o.price, o.status, o.sent_at, o.created_at, o.reply_status, o.pof_requested, o.to_email,
           l.listing_id, l.address, l.city, l.list_price, l.arv, l.score, l.agent_name
    from offers o join listings l using (listing_id)
    where ${sql.unsafe(VIEWS[view].where)}
    order by ${sql.unsafe(SORTS[sort].order)}
    limit 500`;
  const [k] = await sql`
    select count(*) filter (where status in ('sent','replied')) sent,
           count(*) filter (where status = 'draft') drafts,
           count(*) filter (where status = 'approved') approved,
           count(*) filter (where status in ('sent','replied') and sent_at > now() - interval '24 hours') sent24,
           count(*) filter (where pof_requested) pof
    from offers`;

  return (
    <div className="wrap">
      <Header tab="offers" />
      <div className="kpis">
        <div className="kpi"><b>{k.sent}</b><span>Offers sent</span></div>
        <div className="kpi"><b>{k.sent24}</b><span>Sent in 24h</span></div>
        <div className="kpi"><b>{k.drafts}</b><span>Drafts to review</span></div>
        <div className="kpi"><b>{k.approved}</b><span>Approved, waiting to send</span></div>
        <div className="kpi"><b>{k.pof}</b><span>Proof of funds requested</span></div>
      </div>

      <form className="filters">
        <select name="view" defaultValue={view}>
          {Object.entries(VIEWS).map(([v, x]) => <option key={v} value={v}>{x.label}</option>)}
        </select>
        <select name="sort" defaultValue={sort}>
          {Object.entries(SORTS).map(([v, x]) => <option key={v} value={v}>{x.label}</option>)}
        </select>
        <button type="submit">Apply</button>
      </form>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Score</th><th>Address</th><th>Type</th><th className="num">List</th><th className="num">ARV</th>
              <th className="num">Offer</th><th className="num">% of list</th><th>Agent</th><th>Status</th><th>Sent</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={10} className="sub">Nothing here yet.</td></tr>}
            {rows.map((r: any) => (
              <tr key={r.id}>
                <td><Score v={r.score ?? 0} /></td>
                <td><Link href={`/listing/${r.listing_id}`}>{r.address}</Link><div className="sub">{r.city}</div></td>
                <td>{r.kind === "offer" ? "Offer" : "Showing request"}</td>
                <td className="num">{money(r.list_price)}</td>
                <td className="num">{money(r.arv)}</td>
                <td className="num"><b>{money(r.price)}</b></td>
                <td className="num">{r.price && r.list_price ? pct(r.price / r.list_price) : "—"}</td>
                <td>{r.agent_name ?? "—"}<div className="sub">{r.to_email ?? "no email"}</div></td>
                <td><OfferStatus s={r.status} />{r.pof_requested && <span className="pill warn"> POF</span>}</td>
                <td className="sub">{r.sent_at ? `${new Date(r.sent_at).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "short" })} · ${ago(r.sent_at)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
