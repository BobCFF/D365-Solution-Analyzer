import { NextResponse } from "next/server";
import { planImportOrder } from "@/lib/d365/dependencies";
import { authenticate, fail } from "@/lib/server/auth";
import { loadParsed } from "@/lib/store";

/** Suggested import order for everything loaded (dependencies first, patches after their parent). */
export async function GET(req: Request) {
  const a = await authenticate(req);
  if ("res" in a) return a.res;
  try { return NextResponse.json(planImportOrder((await loadParsed(a.ctx)).map((s) => s.parsed))); } catch (e) { return fail(e); }
}
