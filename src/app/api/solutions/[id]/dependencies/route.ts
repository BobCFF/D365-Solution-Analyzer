import { NextResponse } from "next/server";
import { resolveReferences } from "@/lib/d365/dependencies";
import { authenticate, fail } from "@/lib/server/auth";
import { getSolution, loadParsed } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

/** Resolved dependency edges for one solution, checked against every other solution loaded in the workspace. */
export async function GET(req: Request, { params }: Ctx) {
  const a = await authenticate(req);
  if ("res" in a) return a.res;
  const { id } = await params;
  try {
    const s = await getSolution(a.ctx, id);
    if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const others = (await loadParsed(a.ctx, id)).map((o) => o.parsed);
    const resolved = resolveReferences(s.parsed, others).filter((r) => r.status !== "internal" || /^(nav|flow|form|app)-/.test(r.ref.kind));
    const counts: Record<string, number> = {};
    for (const r of resolved) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return NextResponse.json({ resolved: resolved.slice(0, 5000), counts, truncated: resolved.length > 5000 });
  } catch (e) { return fail(e); }
}
