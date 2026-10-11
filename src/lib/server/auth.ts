import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientForRequest } from "@/lib/supabase";
import { loadKeyring, EncryptionConfigError } from "./crypto";

export interface Ctx { db: SupabaseClient; userId: string; email: string }

const allowed = () => (process.env.ALLOWED_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * Authenticate the caller by validating their JWT with Supabase Auth (not just decoding it), enforce the optional
 * ALLOWED_EMAILS allow-list, and make sure encryption is configured before any data is touched.
 */
export async function authenticate(req: Request): Promise<{ ctx: Ctx } | { res: NextResponse }> {
  const db = clientForRequest(req);
  const token = req.headers.get("authorization")?.replace(/^bearer /i, "");
  if (!db || !token) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  try { loadKeyring(); } catch (e) {
    if (e instanceof EncryptionConfigError) return { res: NextResponse.json({ error: "Server encryption is not configured." }, { status: 500 }) };
    throw e;
  }
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const email = (data.user.email ?? "").toLowerCase();
  const list = allowed();
  if (list.length && !list.includes(email)) return { res: NextResponse.json({ error: "This account is not allowed to use this app." }, { status: 403 }) };
  return { ctx: { db, userId: data.user.id, email } };
}

/** Never leak internals (SQL, key ids, stack) to the client. */
export function fail(e: unknown, status = 500): NextResponse {
  const known = e instanceof Error && /already loaded|Invalid solution payload/.test(e.message);
  if (!known) console.error("[api]", e instanceof Error ? e.message : e);
  return NextResponse.json({ error: known ? (e as Error).message : "Request failed" }, { status: known ? 422 : status });
}
