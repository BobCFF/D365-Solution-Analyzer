import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientForRequest } from "@/lib/supabase";
import { loadKeyring, EncryptionConfigError } from "./crypto";
import { apiError } from "./api-response";

export interface Ctx { db: SupabaseClient; userId: string; email: string }

const allowed = () => (process.env.ALLOWED_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * Authenticate the caller: verify the JWT (signature and expiry, via getClaims; Supabase falls back to a server check
 * for legacy symmetric keys), enforce the optional ALLOWED_EMAILS allow-list, and make sure encryption is configured
 * before any data is touched. Returns the response to send on failure.
 */
export async function authenticate(req: Request): Promise<{ ctx: Ctx } | { res: NextResponse }> {
  const db = clientForRequest(req);
  const token = req.headers.get("authorization")?.replace(/^bearer /i, "");
  if (!db || !token) return { res: apiError("Unauthorized", 401, "unauthorized") };
  try { loadKeyring(); } catch (e) {
    if (e instanceof EncryptionConfigError) return { res: apiError("Server encryption is not configured.", 500, "not_configured") };
    throw e;
  }
  const { data, error } = await db.auth.getClaims(token);
  const claims = data?.claims;
  if (error || !claims?.sub || (claims.aud && claims.aud !== "authenticated")) return { res: apiError("Unauthorized", 401, "unauthorized") };
  const email = String(claims.email ?? "").toLowerCase();
  const list = allowed();
  if (list.length && !list.includes(email)) return { res: apiError("This account is not allowed to use this app.", 403, "forbidden") };
  return { ctx: { db, userId: String(claims.sub), email } };
}
