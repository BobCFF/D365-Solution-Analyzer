import { NextResponse } from "next/server";
import { getConnection } from "@/lib/connections";
import { HttpError, isUuid, memoryLimit, withUser } from "@/lib/server/api";
import { DataverseError, testConnection } from "@/lib/server/dataverse";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Signs in and runs three read-only calls (WhoAmI, RetrieveVersion, a metadata probe). Reports what the app user can read. */
export const POST = withUser(async (_req, ctx, params) => {
  if (!isUuid(params.id)) throw new HttpError("Not found", 404, "not_found");
  const limited = memoryLimit(ctx.userId, "connection-test", 10);
  if (limited) return limited;
  const c = await getConnection(ctx, params.id);
  if (!c) throw new HttpError("Not found", 404, "not_found");
  try { return NextResponse.json(await testConnection(c)); }
  catch (e) { if (e instanceof DataverseError) throw new HttpError(e.message, e.status === 403 ? 403 : 502, "environment_error"); throw e; }
});
