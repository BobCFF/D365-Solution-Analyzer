import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request CSP with a nonce: only our own scripts run (no inline/eval/third-party), the page can only talk to
 * itself and the configured Supabase project, and it cannot be framed. Next.js applies the nonce to its own scripts.
 */
/** API writes must come from our own origin and carry JSON (Salesforce Analyzer F12). */
export function apiGuard(req: NextRequest): NextResponse | null {
  if (!req.nextUrl.pathname.startsWith("/api/") || req.method === "GET" || req.method === "HEAD") return null;
  const origin = req.headers.get("origin");
  if (origin) {
    let host = "";
    try { host = new URL(origin).host; } catch { /* malformed origin is rejected below */ }
    if (host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) return NextResponse.json({ error: "Cross-site request refused", code: "forbidden" }, { status: 403 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > 0 && !(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json"))
    return NextResponse.json({ error: "Content-Type must be application/json", code: "unsupported_media_type" }, { status: 415 });
  return null;
}

export function middleware(req: NextRequest) {
  const blocked = apiGuard(req);
  if (blocked) return blocked;
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production";
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${supabase}${dev ? " ws:" : ""}`,
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = { matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)", missing: [{ type: "header", key: "next-router-prefetch" }] }] };
