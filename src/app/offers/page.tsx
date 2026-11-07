import Link from "next/link";
import { sql, migrate } from "@/db";
import { Header, Score, OfferStatus, money, pct, ago } from "../ui";
import { approveOffer, markSent } from "../actions";

export const dynamic = "force-dynamic";

const SENT_SORTS: Record<string, { label: string; order: string }> = {
  recent: { label: "Most recently sent", order: "o.sent_at desc nulls last" },
  best: { label: "Best deal first", order: "l.score desc, (l.arv - o.price) desc nulls last" },
  spread: { label: "Biggest spread (ARV − offer)", order: "(l.arv - o.price) desc nulls last" },
  oldest: { label: "Oldest sent (follow up)", order: "o.sent_at asc nulls last" },
};
const when = (d: any) => new Date(d).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** What to double-check on a draft before approving it. */
function flags(r: any): string[] {
  const f: string[] = [];
  const w = JSON.stringify(r.arv_warnings ?? []);
  if (/older comp/i.test(w)) f.push("older comps");
  if (/set by you/i.test(w)) f.push("your ARV");
  if (/widen radius to 2/i.test(w)) f.push("comps 2 mi away");
  if (r.sqft_source && r.sqft_source !== "MLS") f.push("web sqft");
  if (r.condition_tier === "unknown" || !r.condition_tier) f.push("condition unknown");
  if (r.flood_sfha) f.push(`flood ${r.flood_zone}`);
  if (!r.to_email) f.push("no agent email");
  return f;
}

export default async function Offers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await migrate();
  const sp = await searchParams;
  const sort = SENT_SORTS[sp.sort ?? "recent"] ? sp.sort ?? "recent" : "recent";
  const sending = process.env.SENDING_ENABLED === "true";

  const base = sql`select o.id, o.kind, o.price, o.status, o.sent_at, o.created_at, o.reply_status, o.pof_requested, o.to_email,
      l.listing_id, l.address, l.city, l.list_price, l.arv, l.score, l.agent_name, l.arv_warnings, l.sqft_source, l.condition_tier, l.flood_sfha, l.flood_zone
    from offers o join listings l using (listing_id)`;
  const [approved, drafts, sent] = await Promise.all([
    sql`${base} where o.status = 'approved' order by l.score desc, o.created_at`,
    sql`${base} where o.status = 'draft' and l.hidden = false order by l.score desc, o.created_at desc limit 200`,
    sql`${base} where o.status in ('sent','replied') order by ${sql.unsafe(SENT_SORTS[sort].order)} limit 300`,
  ]);
  const attention = await sql`
    select listing_id, address, city, list_price, score, property_type, beds, sqft, sqft_lookup_at, keyword_hits, arv_warnings, offer_reasons,
      case
        when sqft is null and sqft_lookup_at is null then 'No sqft — web lookup queued (auto)'
        when sqft is null then 'No sqft (web lookup found none) — add sqft from XLeads'
        when arv_warnings::text ilike '%unreliable%' or arv_warnings::text ilike '%disagree%' or offer_reasons::text ilike '%not reliable%' then 'Comps too far apart — verify / pick comps'
        when arv_warnings::text ilike '%fewer than%' then 'Not enough matching comps — pick comps or set ARV'
        when property_type in ('mobile','multi','condo') then 'Few comps for ' || property_type || ' — set ARV'
        else 'Needs review' end as reason
    from listings
    where hidden = false and action = 'needs_data' and analyzed_at is not null
    order by score desc, first_seen desc limit 150`;

  const Section = ({ id, title, count, children, note }: { id: string; title: string; count: number; children: React.ReactNode; note?: React.ReactNode }) => (
    <section id={id} style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 17, margin: "0 0 6px" }}>{title} <span className="sub">({count})</span></h2>
      {note && <p className="sub" style={{ marginTop: 0 }}>{note}</p>}
      {children}
    </section>
  );
  const Empty = ({ cols, text }: { cols: number; text: string }) => <tr><td colSpan={cols} className="sub">{text}</td></tr>;
  const Addr = ({ r }: { r: any }) => <><Link href={`/listing/${r.listing_id}`}>{r.address}</Link><div className="sub">{r.city}</div></>;

  return (
    <div className="wrap">
      <Header tab="offers" />
      <div className="kpis">
        <a className="kpi" href="#ready"><b>{approved.length}</b><span>Approved · ready to send</span></a>
        <a className="kpi" href="#review"><b>{drafts.length}</b><span>Drafts to review & approve</span></a>
        <a className="kpi" href="#sent"><b>{sent.length}</b><span>Sent</span></a>
        <a className="kpi" href="#attention"><b>{attention.length}</b><span>Listings need attention</span></a>
      </div>

      <Section id="ready" title="Approved — ready to send" count={approved.length}
        note={sending ? "Sending is on." : "Sending is OFF until Google Workspace is ready — these will go out once it's on."}>
        <div className="tablewrap"><table>
          <thead><tr><th>Score</th><th>Address</th><th>Type</th><th className="num">List</th><th className="num">ARV</th><th className="num">Offer</th><th className="num">% list</th><th>Agent</th><th></th></tr></thead>
          <tbody>
            {approved.length === 0 && <Empty cols={9} text="Nothing approved yet. Approve drafts below." />}
            {approved.map((r: any) => (
              <tr key={r.id}>
                <td><Score v={r.score ?? 0} /></td><td><Addr r={r} /></td><td>{r.kind === "offer" ? "Offer" : "Showing"}</td>
                <td className="num">{money(r.list_price)}</td><td className="num">{money(r.arv)}</td><td className="num"><b>{money(r.price)}</b></td>
                <td className="num">{r.price && r.list_price ? pct(r.price / r.list_price) : "—"}</td>
                <td>{r.agent_name ?? "—"}<div className="sub">{r.to_email ?? "no email"}</div></td>
                <td><form action={markSent}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="listing_id" value={r.listing_id} /><button className="ghost">Mark sent</button></form></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Section>

      <Section id="review" title="Drafts — review & approve" count={drafts.length} note="Flags show what to double-check before you approve. Open a listing to edit the price or email.">
        <div className="tablewrap"><table>
          <thead><tr><th>Score</th><th>Address</th><th>Type</th><th className="num">List</th><th className="num">ARV</th><th className="num">Offer</th><th className="num">% list</th><th>Check</th><th></th></tr></thead>
          <tbody>
            {drafts.length === 0 && <Empty cols={9} text="No drafts waiting." />}
            {drafts.map((r: any) => (
              <tr key={r.id}>
                <td><Score v={r.score ?? 0} /></td><td><Addr r={r} /></td><td>{r.kind === "offer" ? "Offer" : "Showing"}</td>
                <td className="num">{money(r.list_price)}</td><td className="num">{money(r.arv)}</td><td className="num"><b>{money(r.price)}</b></td>
                <td className="num">{r.price && r.list_price ? pct(r.price / r.list_price) : "—"}</td>
                <td style={{ whiteSpace: "normal", minWidth: 160 }}>{flags(r).map((f) => <span key={f} className="pill warn" style={{ marginRight: 4 }}>{f}</span>)}{flags(r).length === 0 && <span className="pill good">clean</span>}</td>
                <td style={{ display: "flex", gap: 6 }}>
                  <Link className="sub" href={`/listing/${r.listing_id}`}>Review</Link>
                  <form action={approveOffer}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="listing_id" value={r.listing_id} /><button>Approve</button></form>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Section>

      <Section id="sent" title="Sent" count={sent.length}>
        <form className="filters" action="/offers#sent">
          <select name="sort" defaultValue={sort}>{Object.entries(SENT_SORTS).map(([v, x]) => <option key={v} value={v}>{x.label}</option>)}</select>
          <button type="submit">Sort</button>
        </form>
        <div className="tablewrap"><table>
          <thead><tr><th>Score</th><th>Address</th><th className="num">List</th><th className="num">ARV</th><th className="num">Offer</th><th className="num">% list</th><th>Agent</th><th>Status</th><th>Sent</th></tr></thead>
          <tbody>
            {sent.length === 0 && <Empty cols={9} text="No offers sent yet." />}
            {sent.map((r: any) => (
              <tr key={r.id}>
                <td><Score v={r.score ?? 0} /></td><td><Addr r={r} /></td>
                <td className="num">{money(r.list_price)}</td><td className="num">{money(r.arv)}</td><td className="num"><b>{money(r.price)}</b></td>
                <td className="num">{r.price && r.list_price ? pct(r.price / r.list_price) : "—"}</td>
                <td>{r.agent_name ?? "—"}<div className="sub">{r.to_email ?? ""}</div></td>
                <td><OfferStatus s={r.status} />{r.pof_requested && <span className="pill warn" style={{ marginLeft: 4 }}>POF</span>}</td>
                <td className="sub">{r.sent_at ? `${when(r.sent_at)} · ${ago(r.sent_at)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Section>

      <Section id="attention" title="Needs attention" count={attention.length} note="Listings the app couldn't price on its own. Highest score first — fix these to turn them into offers.">
        <div className="tablewrap"><table>
          <thead><tr><th>Score</th><th>Address</th><th className="num">List</th><th>Type</th><th className="num">Bd</th><th className="num">Sqft</th><th>What's needed</th><th>Signals</th><th></th></tr></thead>
          <tbody>
            {attention.length === 0 && <Empty cols={9} text="Nothing needs attention." />}
            {attention.map((r: any) => (
              <tr key={r.listing_id}>
                <td><Score v={r.score ?? 0} /></td><td><Addr r={r} /></td><td className="num">{money(r.list_price)}</td>
                <td>{r.property_type}</td><td className="num">{r.beds ?? "—"}</td><td className="num">{r.sqft ?? "—"}</td>
                <td style={{ whiteSpace: "normal", minWidth: 220 }}>{r.reason}</td>
                <td className="sub" style={{ whiteSpace: "normal" }}>{(r.keyword_hits ?? []).slice(0, 3).join(", ")}</td>
                <td style={{ display: "flex", gap: 8 }}>
                  <Link href={`/listing/${r.listing_id}`}>Fix</Link>
                  <Link className="sub" href={`/analyze?address=${encodeURIComponent(r.address)}`}>Pick comps</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Section>
    </div>
  );
}
