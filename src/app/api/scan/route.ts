import { NextResponse } from "next/server";
import { runScan } from "@/lib/pipeline";

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
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
