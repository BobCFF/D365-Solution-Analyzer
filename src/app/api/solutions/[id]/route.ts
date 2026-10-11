import { NextResponse } from "next/server";
import { auditLimit, HttpError, isUuid, LIMITS, withUser } from "@/lib/server/api";
import { analyzeAndStore, deleteSolution, getSolution, logChange, readFindings } from "@/lib/store";

const idOf = (p: Record<string, string>) => { if (!isUuid(p.id)) throw new HttpError("Not found", 404, "not_found"); return p.id; };

export const GET = withUser(async (_req, ctx, params) => {
  const id = idOf(params);
  const s = await getSolution(ctx, id);
  if (!s) throw new HttpError("Not found", 404, "not_found");
  return NextResponse.json({ solution: { id: s.id, created_at: s.created_at, parsed: s.parsed }, findings: await readFindings(ctx, id) });
});

/** Re-run analysis (e.g. after loading a parent solution). */
export const POST = withUser(async (_req, ctx, params) => {
  const id = idOf(params);
  const limited = await auditLimit(ctx, "analyze", LIMITS.analysesPerHour);
  if (limited) return limited;
  const s = await getSolution(ctx, id);
  if (!s) throw new HttpError("Not found", 404, "not_found");
  const findings = await analyzeAndStore(ctx, id, s.parsed);
  await logChange(ctx, "analyze", "solution", id, `Re-analyzed ${s.meta.uniqueName} ${s.meta.version}; ${findings.length} finding(s)`);
  return NextResponse.json({ findings: findings.length });
});

export const DELETE = withUser(async (_req, ctx, params) => { await deleteSolution(ctx, idOf(params)); return NextResponse.json({ ok: true }); });
