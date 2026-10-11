import { NextResponse } from "next/server";
import { planImportOrder } from "@/lib/d365/dependencies";
import { memoryLimit, withUser } from "@/lib/server/api";
import { loadParsed } from "@/lib/store";

/** Suggested import order for everything loaded (dependencies first, patches after their parent). */
export const GET = withUser(async (_req, ctx) => {
  const limited = memoryLimit(ctx.userId, "plan", 30);
  if (limited) return limited;
  return NextResponse.json(planImportOrder((await loadParsed(ctx)).map((s) => s.parsed)));
});
