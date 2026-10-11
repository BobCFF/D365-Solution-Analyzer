import { NextResponse } from "next/server";
import { compareSolutions } from "@/lib/d365/compare";
import type { ParsedSolution } from "@/lib/d365/types";
import { clientForRequest } from "@/lib/supabase";
import { logChange } from "@/lib/store";

export async function POST(req: Request) {
  const db = clientForRequest(req);
  if (!db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as { leftId?: string; rightId?: string } | null;
  if (!body?.leftId || !body?.rightId) return NextResponse.json({ error: "leftId and rightId required" }, { status: 400 });

  const { data, error } = await db.from("solutions").select("id, parsed").in("id", [body.leftId, body.rightId]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const left = data?.find((s) => s.id === body.leftId), right = data?.find((s) => s.id === body.rightId);
  if (!left || !right) return NextResponse.json({ error: "Solution not found" }, { status: 404 });

  const result = compareSolutions(left.parsed as ParsedSolution, right.parsed as ParsedSolution);
  const { data: row } = await db.from("comparisons")
    .insert({ left_solution_id: left.id, right_solution_id: right.id, result }).select("id").single();
  await logChange(db, "compare", "comparison", row?.id ?? null,
    `Compared ${result.left.uniqueName} ${result.left.version} vs ${result.right.uniqueName} ${result.right.version}: +${result.added.length} -${result.removed.length} ~${result.changed.length}`);
  return NextResponse.json({ result });
}
