import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { validateParsed } from "@/lib/d365/validate";
import { apiGuard } from "@/middleware";
import { isUuid, memoryLimit } from "@/lib/server/api";
import { envProblems } from "@/lib/server/env";
import { log } from "@/lib/server/log";
import { randomBytes } from "node:crypto";

const req = (method: string, headers: Record<string, string> = {}, path = "/api/solutions") =>
  new NextRequest(`https://app.example.com${path}`, { method, headers: { host: "app.example.com", ...headers } });

describe("API guard (CSRF)", () => {
  it("allows same-origin JSON writes and plain reads", () => {
    expect(apiGuard(req("POST", { origin: "https://app.example.com", "content-type": "application/json", "content-length": "10" }))).toBeNull();
    expect(apiGuard(req("GET", { origin: "https://evil.example" }))).toBeNull();
    expect(apiGuard(req("POST", {}, "/page"))).toBeNull();
  });
  it("refuses cross-site writes and non-JSON bodies", async () => {
    expect(apiGuard(req("POST", { origin: "https://evil.example", "content-type": "application/json" }))?.status).toBe(403);
    expect(apiGuard(req("DELETE", { origin: "not a url" }))?.status).toBe(403);
    expect(apiGuard(req("POST", { "content-type": "text/plain", "content-length": "5" }))?.status).toBe(415);
  });
});

describe("payload validation (zod)", () => {
  const ok = { uniqueName: "S", friendlyName: "S", version: "1.0.0.0", managed: false, rootComponents: [], missingDependencies: [], inventory: [], files: [] };
  it("accepts a minimal model and strips unknown keys", () => {
    const v = validateParsed({ ...ok, evil: "<script>" }) as unknown as Record<string, unknown>;
    expect(v.evil).toBeUndefined();
    expect(v.publisher).toBeNull();
  });
  it("rejects malformed nested data that would crash the analyzer", () => {
    expect(() => validateParsed({ ...ok, entities: [{ logical: "x", display: "x", prefix: "", attributes: "nope" }] })).toThrow(/entities/);
    expect(() => validateParsed({ ...ok, flows: [{ id: "1", name: "f", category: 5, stateCode: 0, nodes: [{ id: "a" }], connectionRefs: [], envVars: [], childFlows: [] }] })).toThrow(/flows/);
    expect(() => validateParsed({ ...ok, rootComponents: [{ type: "1", key: "k", behavior: 0 }] })).toThrow(/rootComponents/);
    expect(() => validateParsed({ ...ok, uniqueName: "x".repeat(201) })).toThrow(/uniqueName/);
  });
});

describe("helpers", () => {
  it("validates uuids", () => { expect(isUuid("11111111-1111-1111-1111-111111111111")).toBe(true); expect(isUuid("1; drop table")).toBe(false); });
  it("rate limits per user and bucket", () => {
    const u = `u-${Math.random()}`;
    expect(memoryLimit(u, "t", 2)).toBeNull(); expect(memoryLimit(u, "t", 2)).toBeNull();
    expect(memoryLimit(u, "t", 2)?.status).toBe(429);
    expect(memoryLimit(u, "other", 2)).toBeNull();
  });
  it("reports configuration problems without leaking values", () => {
    const key = `k:${randomBytes(32).toString("base64")}`;
    const bad = envProblems({});
    expect(bad.filter((p) => p.level === "error").length).toBeGreaterThanOrEqual(3);
    const good = envProblems({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "a", DATA_ENCRYPTION_KEY: key, ALLOWED_EMAILS: "a@b.c" });
    expect(good).toEqual([]);
    expect(JSON.stringify(bad)).not.toContain(key);
  });
  it("scrubs secrets and sealed values from logs", () => {
    const out: string[] = [];
    const orig = console.log; console.log = (s: string) => out.push(s);
    log.info("x", { token: "abc", note: "enc:v1:k:a:b", nested: { password: "p", ok: "fine" } });
    console.log = orig;
    expect(out[0]).not.toContain("abc"); expect(out[0]).not.toContain("enc:v1"); expect(out[0]).toContain("fine");
  });
});
