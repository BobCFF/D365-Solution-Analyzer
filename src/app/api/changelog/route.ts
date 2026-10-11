import { NextResponse } from "next/server";
import { authenticate, fail } from "@/lib/server/auth";
import { readLog } from "@/lib/store";

export async function GET(req: Request) {
  const a = await authenticate(req);
  if ("res" in a) return a.res;
  try { return NextResponse.json({ entries: await readLog(a.ctx) }); } catch (e) { return fail(e); }
}
