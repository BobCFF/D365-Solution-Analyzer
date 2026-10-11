import { NextResponse } from "next/server";

/** One error shape everywhere: { error, code } (Salesforce Analyzer O2). */
export function apiError(message: string, status: number, code = "error"): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

/** Thrown by route code to produce a specific, safe client-facing error. */
export class HttpError extends Error {
  constructor(message: string, public status = 400, public code = "bad_request") { super(message); }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
