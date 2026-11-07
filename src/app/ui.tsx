import Link from "next/link";

export const money = (n?: number | null) => (n == null ? "—" : `$${Number(n).toLocaleString("en-US")}`);
export const pct = (n?: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);
export const ago = (d?: Date | string | null) => {
  if (!d) return "—";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export function Header({ tab }: { tab: "listings" | "offers" | "comps" | "analyze" }) {
  return (
    <>
      <header className="top">
        <div>
          <h1>NBA Investments · Offer Desk</h1>
          <div className="sub">South Jersey Shore MLS · scans every few minutes · sending is OFF until Workspace is ready</div>
        </div>
      </header>
      <nav className="tabs">
        <Link href="/" className={tab === "listings" ? "on" : ""}>Listings</Link>
        <Link href="/offers" className={tab === "offers" ? "on" : ""}>Offers</Link>
        <Link href="/analyze" className={tab === "analyze" ? "on" : ""}>Analyze address</Link>
        <Link href="/comps" className={tab === "comps" ? "on" : ""}>Comps</Link>
        <form action="/analyze" style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <input type="search" name="address" placeholder="Analyze an address…" style={{ minWidth: 220 }} />
        </form>
      </nav>
    </>
  );
}

export function Score({ v }: { v: number }) {
  return <span className={`score ${v >= 70 ? "hi" : v >= 40 ? "mid" : ""}`}>{v}</span>;
}

const ACTION: Record<string, [string, string]> = {
  offer: ["Offer ready", "good"],
  showing_request: ["See in person", "blue"],
  skip: ["Skip", ""],
  needs_data: ["Needs comps/sqft", "warn"],
};
export function ActionPill({ a }: { a?: string | null }) {
  if (!a) return <span className="pill">Pending</span>;
  const [label, cls] = ACTION[a] ?? [a, ""];
  return <span className={`pill ${cls}`}>{label}</span>;
}

const OSTATUS: Record<string, string> = { draft: "", approved: "blue", sent: "good", replied: "good", rejected: "bad" };
export function OfferStatus({ s }: { s: string }) {
  return <span className={`pill ${OSTATUS[s] ?? ""}`}>{s}</span>;
}
