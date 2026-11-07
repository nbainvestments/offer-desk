import Link from "next/link";
import { notFound } from "next/navigation";
import { sql, migrate } from "@/db";
import { Header, Score, ActionPill, OfferStatus, money } from "../../ui";
import { saveOffer, approveOffer, rejectOffer, markSent, sendOffer, setSqft } from "../../actions";

export const dynamic = "force-dynamic";

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  await migrate();
  const { id } = await params;
  const [l] = await sql`select * from listings where listing_id = ${Number(id)}`;
  if (!l) notFound();
  const offers = await sql`select * from offers where listing_id = ${l.listing_id} order by created_at desc`;
  const sending = process.env.SENDING_ENABLED === "true";
  const mapUrl = l.lat ? `https://www.google.com/maps?q=${l.lat},${l.lon}` : null;

  return (
    <div className="wrap">
      <Header tab="listings" />
      <p><Link href="/">← Back to listings</Link></p>
      <h2 style={{ margin: "0 0 4px" }}>{l.address}, {l.city} {l.zip}</h2>
      <div className="sub">MLS {l.mls_number} · {l.subtype || l.property_type} · {l.status} · <Score v={l.score ?? 0} /> · <ActionPill a={l.action} />{mapUrl && <> · <a href={mapUrl} target="_blank">Map</a></>}</div>

      <div className="grid2" style={{ marginTop: 14 }}>
        <div>
          <div className="card">
            <h3>Numbers</h3>
            <dl className="kv">
              <dt>List price</dt><dd>{money(l.list_price)}{l.original_price && l.original_price > l.list_price ? ` (orig ${money(l.original_price)})` : ""}</dd>
              <dt>Beds / baths / sqft</dt><dd>{l.beds ?? "?"} / {l.baths ?? "?"} / {l.sqft ?? "?"}</dd>
              <dt>ARV</dt><dd>{money(l.arv)}</dd>
              <dt>Condition (AI)</dt><dd>{l.condition_tier ?? "—"}{l.condition_notes ? ` — ${l.condition_notes}` : ""}</dd>
              <dt>Repairs est.</dt><dd>{l.repairs_low != null ? `${money(l.repairs_low)} – ${money(l.repairs_high)}` : "—"}</dd>
              <dt>Offer</dt><dd><b>{money(l.offer_price)}</b> <span className="sub">{l.offer_formula}</span></dd>
              <dt>Flood zone</dt><dd>{l.flood_zone ?? "Unknown — check FEMA map"}{l.flood_sfha ? " (special flood hazard area)" : ""}</dd>
              <dt>Taxes / HOA</dt><dd>{money(l.taxes)}/yr · {l.hoa_monthly ? `${money(l.hoa_monthly)}/mo` : "—"}</dd>
              <dt>Days on market</dt><dd>{l.dom ?? "—"}</dd>
            </dl>
            {(l.offer_reasons ?? []).length > 0 && <ul className="note">{l.offer_reasons.map((r: string) => <li key={r}>{r}</li>)}</ul>}
            {(l.arv_warnings ?? []).length > 0 && <ul className="note">{l.arv_warnings.map((r: string) => <li key={r}>{r}</li>)}</ul>}
            {!l.sqft && (
              <form action={setSqft} className="filters" style={{ marginTop: 10 }}>
                <input type="hidden" name="listing_id" value={l.listing_id} />
                <input type="number" name="sqft" placeholder="Enter sqft" />
                <button className="ghost">Save sqft & re-analyze</button>
              </form>
            )}
          </div>

          <div className="card">
            <h3>Remarks</h3>
            <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{l.remarks || "—"}</p>
            {(l.signals ?? []).length > 0 && <p className="sub">Signals: {l.signals.join(" · ")}</p>}
          </div>

          <div className="card">
            <h3>Comps used for ARV</h3>
            {(l.arv_comps ?? []).length === 0 ? <p className="sub">No comps yet.</p> : (
              <table style={{ minWidth: 0 }}>
                <thead><tr><th>Address</th><th className="num">Sold</th><th className="num">Sqft</th><th>Closed</th><th className="num">Miles</th></tr></thead>
                <tbody>{l.arv_comps.map((c: any, i: number) => (
                  <tr key={i}><td>{c.address}</td><td className="num">{money(c.salePrice)}</td><td className="num">{c.sqft}</td><td>{String(c.closeDate).slice(0, 10)}</td><td className="num">{c.miles?.toFixed(2)}</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h3>Photos ({(l.photo_urls ?? []).length})</h3>
            <div className="photos">{(l.photo_urls ?? []).slice(0, 40).map((u: string) => <a key={u} href={u.replace("/640/480/", "/2048/1536/")} target="_blank"><img src={u} alt="" loading="lazy" /></a>)}</div>
          </div>
        </div>

        <div>
          <div className="card">
            <h3>Listing agent</h3>
            <dl className="kv">
              <dt>Name</dt><dd>{l.agent_name ?? "—"}</dd>
              <dt>Email</dt><dd>{l.agent_email ? <a href={`mailto:${l.agent_email}`}>{l.agent_email}</a> : "—"}</dd>
              <dt>Phone</dt><dd>{l.agent_phone ?? "—"}</dd>
              <dt>Office</dt><dd>{l.office_name ?? "—"}</dd>
            </dl>
          </div>

          {offers.map((o: any) => (
            <div className="card" key={o.id}>
              <h3>{o.kind === "offer" ? "Offer" : "Showing request"} <OfferStatus s={o.status} /></h3>
              <form action={saveOffer}>
                <input type="hidden" name="id" value={o.id} />
                <input type="hidden" name="listing_id" value={l.listing_id} />
                <div className="filters">
                  <input type="text" name="to" defaultValue={o.to_email ?? ""} placeholder="Agent email" style={{ flex: 1 }} />
                  {o.kind === "offer" && <input type="text" name="price" defaultValue={o.price ?? ""} placeholder="Price" style={{ width: 120 }} />}
                </div>
                <input type="text" name="subject" defaultValue={o.subject} style={{ width: "100%", marginBottom: 8 }} />
                <textarea name="body" defaultValue={o.body} />
                <div className="filters" style={{ marginTop: 8 }}>
                  <button className="ghost">Save edits</button>
                </div>
              </form>
              <div className="filters">
                {o.status === "draft" && <form action={approveOffer}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="listing_id" value={l.listing_id} /><button>Approve</button></form>}
                <form action={sendOffer}><input type="hidden" name="id" value={o.id} /><button disabled={!sending} title={sending ? "" : "Sending is off until Workspace is ready"}>Send</button></form>
                {o.status !== "sent" && <form action={markSent}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="listing_id" value={l.listing_id} /><button className="ghost">Mark as sent</button></form>}
                {o.status !== "rejected" && <form action={rejectOffer}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="listing_id" value={l.listing_id} /><button className="ghost">Discard</button></form>}
              </div>
              {!sending && <p className="sub">Sending is off until Google Workspace is ready. Proof of funds: handled by you when an agent asks.</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
