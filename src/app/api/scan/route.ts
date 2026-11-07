import { NextResponse } from "next/server";
import { runScan } from "@/lib/pipeline";
import { push } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called every few minutes by the scheduler. Protected by CRON_SECRET.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || (auth !== `Bearer ${secret}` && url.searchParams.get("key") !== secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const res = await runScan(Date.now() + 50_000);
    return NextResponse.json(res);
  } catch (e: any) {
    // Alert at most once an hour so a broken feed doesn't spam the phone.
    if (new Date().getMinutes() < 6) await push("Offer Desk scan failing", String(e?.message ?? e).slice(0, 300), { priority: 4, tags: "warning" }).catch(() => {});
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
