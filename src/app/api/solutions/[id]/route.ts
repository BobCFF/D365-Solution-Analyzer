import { NextResponse } from "next/server";
import { authenticate, fail } from "@/lib/server/auth";
import { analyzeAndStore, deleteSolution, getSolution, logChange, readFindings } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, { params }: Ctx) {
  const a = await authenticate(req);
  if ("res" in a) return a.res;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const s = await getSolution(a.ctx, id);
    if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ solution: { id: s.id, created_at: s.created_at, parsed: s.parsed }, findings: await readFindings(a.ctx, id) });
  } catch (e) { return fail(e); }
}

/** Re-run analysis (e.g. after loading a parent solution). */
export async function POST(req: Request, { params }: Ctx) {
  const a = await authenticate(req);
  if ("res" in a) return a.res;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const s = await getSolution(a.ctx, id);
    if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const findings = await analyzeAndStore(a.ctx, id, s.parsed);
    await logChange(a.ctx, "analyze", "solution", id, `Re-analyzed ${s.meta.uniqueName} ${s.meta.version}; ${findings.length} finding(s)`);
    return NextResponse.json({ findings: findings.length });
  } catch (e) { return fail(e); }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const a = await authenticate(req);
  if ("res" in a) return a.res;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try { await deleteSolution(a.ctx, id); return NextResponse.json({ ok: true }); } catch (e) { return fail(e); }
}
