import { NextResponse } from "next/server";
import { compareSolutions } from "@/lib/d365/compare";
import { authenticate, fail } from "@/lib/server/auth";
import { sealJson } from "@/lib/server/crypto";
import { getSolution, logChange } from "@/lib/store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Records a comparison (sealed) and in the audit log; the interactive compare runs in the browser. */
export async function POST(req: Request) {
  const a = await authenticate(req);
  if ("res" in a) return a.res;
  const body = (await req.json().catch(() => null)) as { leftId?: string; rightId?: string } | null;
  if (!body?.leftId || !body?.rightId || !UUID.test(body.leftId) || !UUID.test(body.rightId)) return NextResponse.json({ error: "leftId and rightId required" }, { status: 400 });
  try {
    const [l, r] = await Promise.all([getSolution(a.ctx, body.leftId), getSolution(a.ctx, body.rightId)]);
    if (!l || !r) return NextResponse.json({ error: "Solution not found" }, { status: 404 });
    const result = compareSolutions(l.parsed, r.parsed);
    const { data: row } = await a.ctx.db.from("comparisons").insert({ left_solution_id: l.id, right_solution_id: r.id, result: sealJson(a.ctx.userId, "comparison.result", result) }).select("id").single();
    await logChange(a.ctx, "compare", "comparison", row?.id ?? null,
      `Compared ${result.left.uniqueName} ${result.left.version} vs ${result.right.uniqueName} ${result.right.version}: +${result.added.length} -${result.removed.length} ~${result.changed.length}`);
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}
