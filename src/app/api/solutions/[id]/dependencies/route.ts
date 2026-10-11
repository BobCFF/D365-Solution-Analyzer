import { NextResponse } from "next/server";
import { resolveReferences } from "@/lib/d365/dependencies";
import { HttpError, isUuid, memoryLimit, withUser } from "@/lib/server/api";
import { getSolution, loadParsed } from "@/lib/store";

/** Resolved dependency edges for one solution, checked against every other solution loaded in the workspace. */
export const GET = withUser(async (_req, ctx, params) => {
  if (!isUuid(params.id)) throw new HttpError("Not found", 404, "not_found");
  const limited = memoryLimit(ctx.userId, "deps", 60);
  if (limited) return limited;
  const s = await getSolution(ctx, params.id);
  if (!s) throw new HttpError("Not found", 404, "not_found");
  const others = (await loadParsed(ctx, params.id)).map((o) => o.parsed);
  const resolved = resolveReferences(s.parsed, others).filter((r) => r.status !== "internal" || /^(nav|flow|form|app)-/.test(r.ref.kind));
  const counts: Record<string, number> = {};
  for (const r of resolved) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return NextResponse.json({ resolved: resolved.slice(0, 5000), counts, truncated: resolved.length > 5000 });
});
