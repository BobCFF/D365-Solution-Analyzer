import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anon);

/** Browser client (session kept in localStorage). */
export function browserClient(): SupabaseClient {
  if (!url || !anon) throw new Error("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY).");
  return createClient(url, anon);
}

/** Server client acting as the caller: RLS applies because we forward their JWT. */
export function clientForRequest(req: Request): SupabaseClient | null {
  const auth = req.headers.get("authorization");
  if (!url || !anon || !auth?.toLowerCase().startsWith("bearer ")) return null;
  return createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
