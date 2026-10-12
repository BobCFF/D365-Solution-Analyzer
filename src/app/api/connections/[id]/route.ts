import { NextResponse } from "next/server";
import { deleteConnection } from "@/lib/connections";
import { HttpError, isUuid, withUser } from "@/lib/server/api";
import { logChange } from "@/lib/store";

export const DELETE = withUser(async (_req, ctx, params) => {
  if (!isUuid(params.id)) throw new HttpError("Not found", 404, "not_found");
  await deleteConnection(ctx, params.id);
  await logChange(ctx, "delete", "connection", params.id, "Deleted a Dynamics 365 connection");
  return NextResponse.json({ ok: true });
});
