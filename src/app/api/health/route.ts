import { NextResponse } from "next/server";
import { getEnv } from "@/lib/server/config";
import { envProblems } from "@/lib/server/env";
import { withUser } from "@/lib/server/api";
import { seal, unseal } from "@/lib/server/crypto";
import { APP_VERSION } from "@/lib/version";

const TABLES = ["solutions", "analysis_findings", "comparisons", "change_log", "d365_connections"] as const;
const MIGRATION: Record<string, string> = { d365_connections: "20261013000000_d365_connections.sql" };

/**
 * Deployment self-check for the signed-in user (nothing secret is returned): configuration problems, whether the
 * encrypted-storage migration has been applied, and that encryption round-trips.
 */
export const GET = withUser(async (_req, ctx) => {
  const tables = await Promise.all(TABLES.map(async (t) => {
    const { error } = await ctx.db.from(t).select("id", { count: "exact", head: true });
    return { table: t, ok: !error, hint: error ? `Run supabase/migrations/${MIGRATION[t] ?? "20261012000000_encrypted_storage.sql"} in the Supabase SQL editor.` : undefined };
  }));
  let encryption = false;
  try { encryption = unseal(ctx.userId, "health", seal(ctx.userId, "health", "ok")) === "ok"; } catch { /* reported below */ }
  return NextResponse.json({ version: APP_VERSION, encryption, tables, config: envProblems(), allowList: Boolean((getEnv("ALLOWED_EMAILS") ?? "").trim()) });
});
