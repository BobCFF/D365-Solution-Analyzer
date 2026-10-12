import { NextResponse } from "next/server";
import { resolveReferences } from "@/lib/d365/dependencies";
import { collectTargets } from "@/lib/d365/targetCheck";
import { getConnection } from "@/lib/connections";
import { auditLimit, HttpError, isUuid, memoryLimit, withUser } from "@/lib/server/api";
import { DataverseError, verifyTargets } from "@/lib/server/dataverse";
import { getSolution, loadParsed, logChange } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Check the components this solution still lacks (after looking at every loaded solution) against a real Dynamics 365
 * environment, read-only. Nothing from the environment is stored; the answer is returned to the browser only.
 */
export const POST = withUser(async (req, ctx, params) => {
  if (!isUuid(params.id)) throw new HttpError("Not found", 404, "not_found");
  const body = (await req.json().catch(() => null)) as { connectionId?: unknown } | null;
  if (!isUuid(body?.connectionId)) throw new HttpError("connectionId required");
  const limited = memoryLimit(ctx.userId, "verify", 6);
  if (limited) return limited;
  const hourly = await auditLimit(ctx, "verify", 60);
  if (hourly) return hourly;
  const [s, conn] = await Promise.all([getSolution(ctx, params.id), getConnection(ctx, body.connectionId)]);
  if (!s || !conn) throw new HttpError("Not found", 404, "not_found");
  const others = (await loadParsed(ctx, params.id)).map((o) => o.parsed);
  const targets = collectTargets(s.parsed, resolveReferences(s.parsed, others));
  let result;
  try { result = await verifyTargets(conn, targets); }
  catch (e) { if (e instanceof DataverseError) throw new HttpError(e.message, e.status === 403 ? 403 : e.status === 400 ? 400 : 502, "environment_error"); throw e; }
  await logChange(ctx, "verify", "solution", params.id, `Checked ${result.checkedCount} component(s) of ${s.meta.uniqueName} ${s.meta.version} against "${conn.name}"`);
  return NextResponse.json({ ...result, environment: conn.name });
});
