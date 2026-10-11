import { getEnv, type EnvRecord } from "./config";
import { EncryptionConfigError, loadKeyring } from "./crypto";

/** Configuration problems, logged at startup and shown on the Status panel (never includes values). */
export function envProblems(env: EnvRecord = process.env): { level: "error" | "warn"; message: string }[] {
  const out: { level: "error" | "warn"; message: string }[] = [];
  const url = getEnv("SUPABASE_URL", env) ?? env.NEXT_PUBLIC_SUPABASE_URL, anon = getEnv("SUPABASE_ANON_KEY", env) ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) out.push({ level: "error", message: "Supabase URL is not set (D365_SolAna_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL)." });
  else if (!/^https?:\/\//.test(url)) out.push({ level: "error", message: "The Supabase URL must start with https://." });
  if (!anon) out.push({ level: "error", message: "Supabase anon key is not set (D365_SolAna_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY)." });
  try { loadKeyring(env); } catch (e) {
    out.push({ level: "error", message: e instanceof EncryptionConfigError ? e.message : "DATA_ENCRYPTION_KEY is invalid." });
  }
  if (!(getEnv("ALLOWED_EMAILS", env) ?? "").trim()) out.push({ level: "warn", message: "ALLOWED_EMAILS is empty: any account that can sign in to your Supabase project can use this app. Disable open sign-up in Supabase Auth or set ALLOWED_EMAILS." });
  if (env.NODE_ENV === "production" && url?.startsWith("http://")) out.push({ level: "error", message: "Supabase URL is not HTTPS in production." });
  return out;
}
