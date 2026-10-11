/**
 * Server-side configuration lookup. Every setting may be supplied with the project prefix `D365_SolAna_`
 * (e.g. D365_SolAna_DATA_ENCRYPTION_KEY) so several apps can share one Vercel team without name clashes;
 * the unprefixed name is the fallback. Browser-visible values (Supabase URL / anon key) are mapped in
 * next.config.mjs, which inlines them at build time from the prefixed or the NEXT_PUBLIC_ names.
 */
export const ENV_PREFIX = "D365_SolAna_";

export type EnvRecord = Record<string, string | undefined>;

/** `name` is the unprefixed setting name, e.g. "DATA_ENCRYPTION_KEY". */
export function getEnv(name: string, env: EnvRecord = process.env): string | undefined {
  const v = env[ENV_PREFIX + name];
  return v !== undefined && v.trim() !== "" ? v : env[name];
}
