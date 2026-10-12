import { getConnection } from "@/lib/connections";
import { HttpError, isUuid, memoryLimit, withUser } from "@/lib/server/api";

/** The PUBLIC certificate of a certificate connection (to upload to the Entra app registration). Never the private key. */
export const GET = withUser(async (_req, ctx, params) => {
  if (!isUuid(params.id)) throw new HttpError("Not found", 404, "not_found");
  const limited = memoryLimit(ctx.userId, "connection-cert", 30);
  if (limited) return limited;
  const c = await getConnection(ctx, params.id);
  if (!c || c.authType !== "certificate" || !c.certificatePem) throw new HttpError("Not found", 404, "not_found");
  return Response.json({ certificatePem: c.certificatePem });
});
