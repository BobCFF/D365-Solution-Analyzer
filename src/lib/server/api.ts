import { NextResponse } from "next/server";
import { authenticate, type Ctx } from "./auth";
import { apiError, HttpError } from "./api-response";
import { DecryptionError } from "./crypto";
import { log, errMsg } from "./log";

export { apiError, HttpError, isUuid } from "./api-response";

type Params = Record<string, string>;
type Handler = (req: Request, ctx: Ctx, params: Params) => Promise<Response | NextResponse>;

/**
 * Wrap a route: authenticate, then run the handler. Anything thrown becomes a logged, generic JSON error so clients
 * never see SQL, key ids or stack traces (Salesforce Analyzer's withUser, B4/F15).
 */
export function withUser(handler: Handler) {
  return async (req: Request, route?: { params?: Promise<Params> }): Promise<Response> => {
    const a = await authenticate(req);
    if ("res" in a) return a.res;
    try {
      return await handler(req, a.ctx, (await route?.params) ?? {});
    } catch (e) {
      if (e instanceof HttpError) return apiError(e.message, e.status, e.code);
      if (e instanceof DecryptionError) {
        log.error("decrypt_failed", { path: new URL(req.url).pathname });
        return apiError("Stored data could not be decrypted. Check DATA_ENCRYPTION_KEY(S) configuration.", 500, "decrypt_failed");
      }
      log.error("route_error", { path: new URL(req.url).pathname, message: errMsg(e) });
      return apiError("Request failed", 500, "internal");
    }
  };
}

/* ---------------- abuse limits (Salesforce Analyzer F8) ---------------- */

const hits = new Map<string, number[]>();
/** Best-effort per-instance limiter for read endpoints that decrypt a lot (serverless instances don't share memory). */
export function memoryLimit(userId: string, bucket: string, max: number, windowMs = 60_000): Response | null {
  const key = `${bucket}:${userId}`, now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { hits.set(key, recent); return apiError("Too many requests, slow down.", 429, "rate_limited"); }
  recent.push(now); hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return null;
}

export const LIMITS = { uploadsPerHour: 60, analysesPerHour: 120, comparesPerHour: 240, maxSolutions: 200 } as const;

/** Durable limiter for mutating actions: counts the user's own audit-log rows (shared across instances, no extra table). */
export async function auditLimit(ctx: Ctx, action: "upload" | "analyze" | "compare" | "verify", max: number): Promise<Response | null> {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count, error } = await ctx.db.from("change_log").select("id", { count: "exact", head: true }).eq("action", action).gte("created_at", since);
  if (error) { log.warn("rate_limit_check_failed", { action, message: errMsg(error) }); return null; } // fail open on a limiter outage, never block the user's data
  return (count ?? 0) >= max ? apiError(`Hourly limit reached for this action (${max}/hour).`, 429, "rate_limited") : null;
}
