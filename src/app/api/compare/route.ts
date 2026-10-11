import { NextResponse } from "next/server";
import { compareSolutions } from "@/lib/d365/compare";
import { auditLimit, HttpError, isUuid, LIMITS, withUser } from "@/lib/server/api";
import { sealJson } from "@/lib/server/crypto";
import { getSolution, logChange } from "@/lib/store";

/** Records a comparison (sealed) and in the audit log; the interactive compare runs in the browser. */
export const POST = withUser(async (req, ctx) => {
  const body = (await req.json().catch(() => null)) as { leftId?: unknown; rightId?: unknown } | null;
  if (!isUuid(body?.leftId) || !isUuid(body?.rightId)) throw new HttpError("leftId and rightId required");
  const limited = await auditLimit(ctx, "compare", LIMITS.comparesPerHour);
  if (limited) return limited;
  const [l, r] = await Promise.all([getSolution(ctx, body.leftId), getSolution(ctx, body.rightId)]);
  if (!l || !r) throw new HttpError("Solution not found", 404, "not_found");
  const result = compareSolutions(l.parsed, r.parsed);
  const { data: row } = await ctx.db.from("comparisons").insert({ left_solution_id: l.id, right_solution_id: r.id, result: sealJson(ctx.userId, "comparison.result", result) }).select("id").single();
  await logChange(ctx, "compare", "comparison", row?.id ?? null, `Compared ${result.left.uniqueName} ${result.left.version} vs ${result.right.uniqueName} ${result.right.version}: +${result.added.length} -${result.removed.length} ~${result.changed.length}`);
  return NextResponse.json({ ok: true });
});
