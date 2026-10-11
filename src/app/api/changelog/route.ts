import { NextResponse } from "next/server";
import { clientForRequest } from "@/lib/supabase";

export async function GET(req: Request) {
  const db = clientForRequest(req);
  if (!db) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await db.from("change_log").select("*").order("created_at", { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data });
}
