import { NextResponse } from "next/server";
import { parseSolutionZip, SolutionParseError } from "@/lib/d365/parser";
import { clientForRequest } from "@/lib/supabase";
import { analyzeAndStore, insertSolution, logChange } from "@/lib/store";

export const runtime = "nodejs";
const MAX_UPLOAD = 4 * 1024 * 1024; // Vercel serverless request body limit is ~4.5 MB

export async function GET(req: Request) {
  const db = clientForRequest(req);
  if (!db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await db
    .from("solutions")
    .select("id, unique_name, friendly_name, version, managed, parent_solution_name, publisher_prefix, file_name, created_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ solutions: data });
}

export async function POST(req: Request) {
  const db = clientForRequest(req);
  if (!db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".zip")) return NextResponse.json({ error: "Upload a .zip solution package" }, { status: 400 });
  if (file.size > MAX_UPLOAD) return NextResponse.json({ error: "File exceeds the 4 MB upload limit" }, { status: 413 });

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = await parseSolutionZip(bytes);
    const id = await insertSolution(db, parsed, file.name, bytes);
    const findings = await analyzeAndStore(db, id, parsed);
    await logChange(db, "upload", "solution", id,
      `Loaded ${parsed.uniqueName} ${parsed.version} (${parsed.managed ? "managed" : "unmanaged"}${parsed.parentSolutionName ? ", patch" : ""}); ${findings.length} finding(s)`);
    return NextResponse.json({ id, findings }, { status: 201 });
  } catch (e) {
    const status = e instanceof SolutionParseError ? 422 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
