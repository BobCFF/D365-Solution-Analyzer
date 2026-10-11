import { EncryptionConfigError, loadKeyring } from "./crypto";

/** Configuration problems, logged at startup and shown on the Status panel (never includes values). */
export function envProblems(env: Record<string, string | undefined> = process.env): { level: "error" | "warn"; message: string }[] {
  const out: { level: "error" | "warn"; message: string }[] = [];
  if (!env.NEXT_PUBLIC_SUPABASE_URL) out.push({ level: "error", message: "NEXT_PUBLIC_SUPABASE_URL is not set." });
  else if (!/^https?:\/\//.test(env.NEXT_PUBLIC_SUPABASE_URL)) out.push({ level: "error", message: "NEXT_PUBLIC_SUPABASE_URL must start with https://." });
  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) out.push({ level: "error", message: "NEXT_PUBLIC_SUPABASE_ANON_KEY is not set." });
  try { loadKeyring(env); } catch (e) {
    out.push({ level: "error", message: e instanceof EncryptionConfigError ? e.message : "DATA_ENCRYPTION_KEY is invalid." });
  }
  if (!(env.ALLOWED_EMAILS ?? "").trim()) out.push({ level: "warn", message: "ALLOWED_EMAILS is empty: any account that can sign in to your Supabase project can use this app. Disable open sign-up in Supabase Auth or set ALLOWED_EMAILS." });
  if (env.NODE_ENV === "production" && env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http://")) out.push({ level: "error", message: "Supabase URL is not HTTPS in production." });
  return out;
}
