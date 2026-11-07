import { sql, migrate } from "@/db";

/** Pull MLS numbers out of a Paragon CSV export (any column whose header mentions "MLS"). */
export function mlsIdsFromCsv(text: string): number[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (l: string) => {
    const out: string[] = []; let cur = ""; let q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = split(lines[0]).map((h) => h.toLowerCase());
  const col = header.findIndex((h) => /mls/.test(h));
  const ids = new Set<number>();
  for (const l of lines.slice(col >= 0 ? 1 : 0)) {
    const cells = split(l);
    const cand = col >= 0 ? [cells[col]] : cells;
    for (const c of cand) {
      const n = Number(String(c ?? "").replace(/[^0-9]/g, ""));
      if (n >= 100000 && n <= 9999999) { ids.add(n); break; }
    }
  }
  return [...ids];
}

export async function queueComps(ids: number[]) {
  await migrate();
  if (!ids.length) return 0;
  const rows = ids.map((listing_id) => ({ listing_id }));
  const res = await sql`insert into comp_queue ${sql(rows)} on conflict (listing_id) do nothing`;
  return res.count;
}
