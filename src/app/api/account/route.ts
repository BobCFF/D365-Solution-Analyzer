import { NextResponse } from "next/server";
import { authenticate, fail } from "@/lib/server/auth";
import { purgeAll } from "@/lib/store";

/** Right to erasure: delete every solution, finding, comparison and history entry this user has stored. */
export async function DELETE(req: Request) {
  const a = await authenticate(req);
  if ("res" in a) return a.res;
  if (req.headers.get("x-confirm") !== "delete-all-my-data") return NextResponse.json({ error: "Confirmation header required" }, { status: 400 });
  try { await purgeAll(a.ctx); return NextResponse.json({ ok: true }); } catch (e) { return fail(e); }
}
