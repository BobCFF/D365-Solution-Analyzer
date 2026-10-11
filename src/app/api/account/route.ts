import { NextResponse } from "next/server";
import { HttpError, withUser } from "@/lib/server/api";
import { purgeAll } from "@/lib/store";

/** Right to erasure: delete every solution, finding, comparison and history entry this user has stored. */
export const DELETE = withUser(async (req, ctx) => {
  if (req.headers.get("x-confirm") !== "delete-all-my-data") throw new HttpError("Confirmation header required");
  await purgeAll(ctx);
  return NextResponse.json({ ok: true });
});
