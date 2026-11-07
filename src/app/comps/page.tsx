import { revalidatePath } from "next/cache";
import { sql, migrate } from "@/db";
import { mlsIdsFromCsv, queueComps } from "@/lib/compsImport";
import { Header, money, ago, longDate } from "../ui";

export const dynamic = "force-dynamic";

async function upload(form: FormData) {
  "use server";
  const f = form.get("file");
  if (!(f instanceof File) || f.size === 0) return;
  const ids = mlsIdsFromCsv(await f.text());
  await queueComps(ids);
  revalidatePath("/comps");
}

export default async function Comps() {
  await migrate();
  const [k] = await sql`
    select (select count(*) from sold_comps) comps,
           (select count(*) from sold_comps where sqft is not null) with_sqft,
           (select min(close_date) from sold_comps) oldest,
           (select max(close_date) from sold_comps) newest,
           (select count(*) from comp_queue where done_at is null) queued,
           (select count(*) from comp_queue where error is not null) errors`;
  const recent = await sql`select address, beds, baths, sqft, sale_price, close_date, property_type from sold_comps order by close_date desc nulls last limit 50`;

  return (
    <div className="wrap">
      <Header tab="comps" />
      <div className="kpis">
        <div className="kpi"><b>{k.comps}</b><span>Sold comps on file</span></div>
        <div className="kpi"><b>{k.with_sqft}</b><span>With sqft (usable for ARV)</span></div>
        <div className="kpi"><b>{longDate(k.oldest)}</b><span>Oldest sale</span></div>
        <div className="kpi"><b>{longDate(k.newest)}</b><span>Newest sale</span></div>
        <div className="kpi"><b>{k.queued}</b><span>Waiting to import</span></div>
      </div>

      <div className="card">
        <h3>Upload sold export</h3>
        <p className="sub" style={{ marginTop: 0 }}>
          Paragon sold search → export → in Numbers: File → Export To → CSV. Only the MLS # column is needed — the app pulls sale price,
          close date, beds, sqft and location for each one. Upload a fresh export about once a month.
        </p>
        <form action={upload} className="filters">
          <input type="file" name="file" accept=".csv,text/csv" required />
          <button type="submit">Upload</button>
        </form>
        {Number(k.queued) > 0 && <p className="note">{k.queued} sold listings importing — about 60 per scan, so give it {Math.ceil(Number(k.queued) / 60) * 5}–{Math.ceil(Number(k.queued) / 60) * 10} minutes.</p>}
      </div>

      <div className="tablewrap">
        <table>
          <thead><tr><th>Address</th><th>Type</th><th className="num">Beds</th><th className="num">Baths</th><th className="num">Sqft</th><th className="num">Sold</th><th>Closed</th></tr></thead>
          <tbody>
            {recent.length === 0 && <tr><td colSpan={7} className="sub">No comps yet.</td></tr>}
            {recent.map((r: any, i: number) => (
              <tr key={i}><td>{r.address}</td><td>{r.property_type}</td><td className="num">{r.beds ?? "—"}</td><td className="num">{r.baths ?? "—"}</td><td className="num">{r.sqft ?? "—"}</td><td className="num">{money(r.sale_price)}</td><td>{longDate(r.close_date)} <span className="sub">{r.close_date ? ago(r.close_date) : ""}</span></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
