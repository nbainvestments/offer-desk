import { NextResponse, type NextRequest } from "next/server";

// Simple password gate for the whole dashboard (MLS data is not public).
export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/scan") || req.nextUrl.pathname.startsWith("/api/comps") || req.nextUrl.pathname.startsWith("/api/stats")) return NextResponse.next(); // own secret
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return new NextResponse("Set DASHBOARD_PASSWORD", { status: 503 });
  const h = req.headers.get("authorization") ?? "";
  const [, b64] = h.split(" ");
  const pass = b64 ? atob(b64).split(":").slice(1).join(":") : "";
  if (pass === pw) return NextResponse.next();
  return new NextResponse("Login required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Offer Desk"' } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
