import { NextResponse } from "next/server";
import { validateParsed } from "@/lib/d365/validate";
import { authenticate, fail } from "@/lib/server/auth";
import { analyzeAndStore, insertSolution, listSolutions, logChange } from "@/lib/store";

export const runtime = "nodejs";
const MAX_BODY = 4 * 1024 * 1024; // Vercel serverless request body limit is ~4.5 MB

export async function GET(req: Request) {
  const a = await authenticate(req);
  if ("res" in a) return a.res;
  try { return NextResponse.json({ solutions: await listSolutions(a.ctx) }); } catch (e) { return fail(e); }
}

/**
 * The browser unpacks the .zip and sends only the parsed model (the package itself never leaves the user's machine).
 * Everything is sealed with the user's key before it is written to the database.
 */
export async function POST(req: Request) {
  const a = await authenticate(req);
  if ("res" in a) return a.res;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) return NextResponse.json({ error: "Parsed solution is too large (4 MB limit)" }, { status: 413 });
  const body = (await req.json().catch(() => null)) as { fileName?: unknown; fileSha256?: unknown; parsed?: unknown } | null;
  if (typeof body?.fileName !== "string" || typeof body.fileSha256 !== "string" || !/^[0-9a-f]{64}$/.test(body.fileSha256))
    return NextResponse.json({ error: "fileName and fileSha256 required" }, { status: 400 });
  try {
    const parsed = validateParsed(body.parsed);
    const id = await insertSolution(a.ctx, parsed, body.fileName.slice(0, 260), body.fileSha256);
    const findings = await analyzeAndStore(a.ctx, id, parsed);
    await logChange(a.ctx, "upload", "solution", id,
      `Loaded ${parsed.uniqueName} ${parsed.version} (${parsed.managed ? "managed" : "unmanaged"}${parsed.parentSolutionName ? ", patch" : ""}); ${findings.length} finding(s)`);
    return NextResponse.json({ id, findings: findings.length }, { status: 201 });
  } catch (e) { return fail(e); }
}
