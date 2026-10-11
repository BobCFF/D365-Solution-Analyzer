/**
 * Structured JSON-line logging for server code (Salesforce Analyzer's O1/log.ts pattern).
 * Never log solution content: callers pass ids, counts and error classes only, and anything that looks like a
 * secret or a sealed value is scrubbed as a second line of defence.
 */
const SECRET_KEY = /authorization|token|key|secret|password|cookie|jwt|bearer/i;

function scrub(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return v.startsWith("enc:v1:") ? "[sealed]" : v.length > 300 ? `${v.slice(0, 300)}…` : v;
  if (depth > 3 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrub(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SECRET_KEY.test(k) ? "[redacted]" : scrub(x, depth + 1)]));
}

function emit(level: "info" | "warn" | "error", event: string, data?: Record<string, unknown>) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...(scrub(data) as object | undefined) });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export const log = {
  info: (event: string, data?: Record<string, unknown>) => emit("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) => emit("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) => emit("error", event, data),
};

/** Error class + message only (messages from our own code and Supabase never include solution content). */
export const errMsg = (e: unknown): string => (e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300));
