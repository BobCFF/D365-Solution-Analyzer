import { NextResponse } from "next/server";
import { validateParsed } from "@/lib/d365/validate";
import { auditLimit, HttpError, LIMITS, withUser } from "@/lib/server/api";
import { analyzeAndStore, countSolutions, insertSolution, listSolutions, logChange } from "@/lib/store";

export const runtime = "nodejs";
const MAX_BODY = 4 * 1024 * 1024; // Vercel serverless request body limit is ~4.5 MB

export const GET = withUser(async (_req, ctx) => NextResponse.json(await listSolutions(ctx)));

/**
 * The browser unpacks the .zip and sends only the parsed model (the package itself never leaves the user's machine).
 * It is validated with zod, then everything is sealed with the user's key before it is written to the database.
 */
export const POST = withUser(async (req, ctx) => {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) throw new HttpError("Parsed solution is too large (4 MB limit)", 413, "too_large");
  const limited = await auditLimit(ctx, "upload", LIMITS.uploadsPerHour);
  if (limited) return limited;
  if ((await countSolutions(ctx)) >= LIMITS.maxSolutions) throw new HttpError(`You can store up to ${LIMITS.maxSolutions} solutions; delete some first.`, 409, "quota");
  const body = (await req.json().catch(() => null)) as { fileName?: unknown; fileSha256?: unknown; parsed?: unknown } | null;
  if (typeof body?.fileName !== "string" || typeof body.fileSha256 !== "string" || !/^[0-9a-f]{64}$/.test(body.fileSha256)) throw new HttpError("fileName and fileSha256 required");
  let parsed;
  try { parsed = validateParsed(body.parsed); } catch (e) { throw new HttpError((e as Error).message, 422, "invalid_payload"); }
  let id: string;
  try { id = await insertSolution(ctx, parsed, body.fileName.slice(0, 260), body.fileSha256); }
  catch (e) { if (/already loaded/.test((e as Error).message)) throw new HttpError((e as Error).message, 409, "duplicate"); throw e; }
  const findings = await analyzeAndStore(ctx, id, parsed);
  await logChange(ctx, "upload", "solution", id, `Loaded ${parsed.uniqueName} ${parsed.version} (${parsed.managed ? "managed" : "unmanaged"}${parsed.parentSolutionName ? ", patch" : ""}); ${findings.length} finding(s)`);
  return NextResponse.json({ id, findings: findings.length }, { status: 201 });
});
