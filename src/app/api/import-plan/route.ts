import { NextResponse } from "next/server";
import { planImportOrder } from "@/lib/d365/dependencies";
import { clientForRequest } from "@/lib/supabase";
import { loadParsed } from "@/lib/store";

/** Suggested import order for everything loaded (dependencies first, patches after their parent). */
export async function GET(req: Request) {
  const db = clientForRequest(req);
  if (!db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(planImportOrder((await loadParsed(db)).map((s) => s.parsed)));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
