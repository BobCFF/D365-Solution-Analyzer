import { NextResponse } from "next/server";
import { validateConnectionInput } from "@/lib/d365/environment";
import { countConnections, insertConnection, listConnections, MAX_CONNECTIONS } from "@/lib/connections";
import { HttpError, memoryLimit, withUser } from "@/lib/server/api";
import { logChange } from "@/lib/store";

export const runtime = "nodejs";

/** Saved connections, WITHOUT their client secrets (those never leave the server). */
export const GET = withUser(async (_req, ctx) => NextResponse.json(await listConnections(ctx)));

export const POST = withUser(async (req, ctx) => {
  const limited = memoryLimit(ctx.userId, "connections", 20);
  if (limited) return limited;
  if ((await countConnections(ctx)) >= MAX_CONNECTIONS) throw new HttpError(`You can save up to ${MAX_CONNECTIONS} connections; delete one first.`, 409, "quota");
  let input;
  try { input = validateConnectionInput(await req.json().catch(() => null)); } catch (e) { throw new HttpError((e as Error).message, 422, "invalid_payload"); }
  const saved = await insertConnection(ctx, input);
  await logChange(ctx, "connect", "connection", saved.id, `Saved Dynamics 365 connection "${input.name}" (${new URL(input.environmentUrl).hostname})`);
  return NextResponse.json({ connection: saved }, { status: 201 });
});
