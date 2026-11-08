import { NextResponse } from "next/server";
import { askListing } from "@/lib/dealChat";
import { sql, migrate } from "@/db";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

// Behind the dashboard password (middleware). POST {listingId, question?} ; DELETE ?listingId= clears the thread.
export async function POST(req: Request) {
  await migrate();
  const { listingId, question } = await req.json();
  try {
    const answer = await askListing(Number(listingId), question ?? null);
    return NextResponse.json({ answer });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("listingId"));
  await sql`delete from listing_chat where listing_id = ${id}`;
  return NextResponse.json({ ok: true });
}
