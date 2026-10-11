import { NextResponse } from "next/server";
import { validateParsed } from "@/lib/d365/validate";
import { clientForRequest } from "@/lib/supabase";
import { analyzeAndStore, insertSolution, logChange } from "@/lib/store";

export const runtime = "nodejs";
const MAX_BODY = 4 * 1024 * 1024; // Vercel serverless request body limit is ~4.5 MB

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

/**
 * The browser unpacks the .zip and sends only the parsed model (the package itself never
 * leaves the user's machine, and the Vercel request-body limit is not an issue).
 */
export async function POST(req: Request) {
  const db = clientForRequest(req);
  if (!db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) return NextResponse.json({ error: "Parsed solution is too large (4 MB limit)" }, { status: 413 });
  const body = (await req.json().catch(() => null)) as { fileName?: unknown; fileSha256?: unknown; parsed?: unknown } | null;
  if (typeof body?.fileName !== "string" || typeof body.fileSha256 !== "string" || !/^[0-9a-f]{64}$/.test(body.fileSha256))
    return NextResponse.json({ error: "fileName and fileSha256 required" }, { status: 400 });

  try {
    const parsed = validateParsed(body.parsed);
    const id = await insertSolution(db, parsed, body.fileName.slice(0, 260), body.fileSha256);
    const findings = await analyzeAndStore(db, id, parsed);
    await logChange(db, "upload", "solution", id,
      `Loaded ${parsed.uniqueName} ${parsed.version} (${parsed.managed ? "managed" : "unmanaged"}${parsed.parentSolutionName ? ", patch" : ""}); ${findings.length} finding(s)`);
    return NextResponse.json({ id, findings }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
}
