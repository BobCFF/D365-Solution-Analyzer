import { NextResponse } from "next/server";
import { memoryLimit, withUser } from "@/lib/server/api";
import { exportAll } from "@/lib/store";

/** Right of access / portability: everything stored for this user, decrypted, as a JSON download. */
export const GET = withUser(async (_req, ctx) => {
  const limited = memoryLimit(ctx.userId, "export", 5);
  if (limited) return limited;
  return new NextResponse(JSON.stringify(await exportAll(ctx), null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="d365-solution-analyzer-export.json"' },
  });
});
