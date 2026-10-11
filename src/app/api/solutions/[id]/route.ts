import { NextResponse } from "next/server";
import type { ParsedSolution } from "@/lib/d365/types";
import { clientForRequest } from "@/lib/supabase";
import { analyzeAndStore, logChange } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const db = clientForRequest(req);
  if (!db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { data: solution, error } = await db.from("solutions").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!solution) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: findings } = await db.from("analysis_findings").select("*").eq("solution_id", id).order("id");
  return NextResponse.json({ solution, findings: findings ?? [] });
}

/** Re-run analysis (e.g. after loading a parent solution). */
export async function POST(req: Request, { params }: Ctx) {
  const db = clientForRequest(req);
  if (!db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { data, error } = await db.from("solutions").select("parsed").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const findings = await analyzeAndStore(db, id, data.parsed as ParsedSolution);
  await logChange(db, "analyze", "solution", id, `Re-analyzed; ${findings.length} finding(s)`);
  return NextResponse.json({ findings });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const db = clientForRequest(req);
  if (!db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { data } = await db.from("solutions").select("unique_name, version").eq("id", id).maybeSingle();
  const { error } = await db.from("solutions").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logChange(db, "delete", "solution", id, `Deleted ${data?.unique_name ?? id} ${data?.version ?? ""}`.trim());
  return NextResponse.json({ ok: true });
}
