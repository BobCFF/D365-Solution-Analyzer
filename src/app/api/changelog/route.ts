import { NextResponse } from "next/server";
import { withUser } from "@/lib/server/api";
import { readLog } from "@/lib/store";

export const GET = withUser(async (_req, ctx) => NextResponse.json({ entries: await readLog(ctx) }));
