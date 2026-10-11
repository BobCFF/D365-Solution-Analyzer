import { NextResponse } from "next/server";
import { resolveReferences } from "@/lib/d365/dependencies";
import type { ParsedSolution } from "@/lib/d365/types";
import { clientForRequest } from "@/lib/supabase";
import { loadParsed } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

/** Resolved dependency edges for one solution, checked against every other solution loaded in the workspace. */
export async function GET(req: Request, { params }: Ctx) {
  const db = clientForRequest(req);
  if (!db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { data, error } = await db.from("solutions").select("parsed").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const others = (await loadParsed(db, id)).map((o) => o.parsed);
  const sol = data.parsed as ParsedSolution;
  const resolved = resolveReferences(sol, others).filter((r) => r.status !== "internal" || r.ref.kind.startsWith("nav-") || r.ref.kind.startsWith("flow-") || r.ref.kind.startsWith("form-") || r.ref.kind.startsWith("app-"));
  const counts: Record<string, number> = {};
  for (const r of resolved) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return NextResponse.json({ resolved: resolved.slice(0, 5000), counts, truncated: resolved.length > 5000 });
}
