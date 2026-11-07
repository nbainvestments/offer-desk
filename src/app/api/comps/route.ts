import { NextResponse } from "next/server";
import { queueComps } from "@/lib/compsImport";

export const dynamic = "force-dynamic";

// POST {"ids":[...MLS numbers]} with Authorization: Bearer CRON_SECRET -> queues sold comps for import.
export async function POST(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { ids } = await req.json();
  const clean = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => n >= 100000 && n <= 9999999);
  const added = await queueComps(clean);
  return NextResponse.json({ received: clean.length, added });
}
