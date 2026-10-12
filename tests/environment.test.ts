import { describe, expect, it } from "vitest";
import { authorityHost, normalizeEnvironmentUrl, validateConnectionInput } from "@/lib/d365/environment";
import { DataverseError, getAccessToken, testConnection, verifyTargets } from "@/lib/server/dataverse";
import { applyTargetResult, collectTargets, type TargetResult } from "@/lib/d365/targetCheck";
import { buildMissingRows } from "@/lib/d365/missingDeps";
import type { ParsedSolution } from "@/lib/d365/types";

const GUID = "11111111-2222-3333-4444-555555555555";
const SECRET = "s3cr3t-value-DO-NOT-LEAK";
const cfg = { environmentUrl: "https://org.crm4.dynamics.com", tenantId: GUID, clientId: GUID, clientSecret: SECRET };

describe("environment URL validation (0.12.0)", () => {
  it("accepts Dataverse hosts and normalises to the origin", () => {
    expect(normalizeEnvironmentUrl("https://org.crm.dynamics.com/main.aspx?x=1")).toBe("https://org.crm.dynamics.com");
    expect(normalizeEnvironmentUrl("https://org-1.crm4.dynamics.com")).toBe("https://org-1.crm4.dynamics.com");
    expect(authorityHost("https://x.crm.dynamics.cn")).toBe("login.partner.microsoftonline.cn");
    expect(authorityHost("https://x.crm.microsoftdynamics.us")).toBe("login.microsoftonline.us");
    expect(authorityHost("https://x.crm.dynamics.com")).toBe("login.microsoftonline.com");
  });
  it("rejects anything that is not a Microsoft-hosted Dataverse https URL", () => {
    for (const bad of ["http://org.crm.dynamics.com", "https://evil.com", "https://org.crm.dynamics.com.evil.com", "https://a:b@org.crm.dynamics.com", "https://org.crm.dynamics.com:8443", "https://169.254.169.254", "https://localhost", "not a url", "https://crm.dynamics.com"]) {
      expect(() => normalizeEnvironmentUrl(bad), bad).toThrow();
    }
  });
  it("validates the whole connection form", () => {
    const ok = validateConnectionInput({ name: " Prod ", environmentUrl: "https://org.crm.dynamics.com/", tenantId: GUID, clientId: GUID, clientSecret: SECRET });
    expect(ok.name).toBe("Prod");
    expect(() => validateConnectionInput({ ...ok, clientId: "nope" })).toThrow(/Client ID/);
    expect(() => validateConnectionInput({ ...ok, tenantId: "x" })).toThrow(/Tenant/);
    expect(() => validateConnectionInput({ ...ok, clientSecret: "short" })).toThrow(/secret/i);
    expect(() => validateConnectionInput(null)).toThrow();
  });
});

type Route = (url: string, init?: RequestInit) => { status?: number; body?: unknown; headers?: Record<string, string> };
const mockFetch = (route: Route) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = route(String(url), init);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: r.headers });
  }) as typeof fetch;
  return { f, calls };
};
const tokenOk = (u: string) => (u.includes("/oauth2/v2.0/token") ? { body: { access_token: "tok" } } : null);

describe("Dataverse client (0.12.0)", () => {
  it("signs in with client credentials against the right authority and scope, never following redirects", async () => {
    const { f, calls } = mockFetch((u) => tokenOk(u) ?? { body: {} });
    await getAccessToken(cfg, f);
    expect(calls[0].url).toBe(`https://login.microsoftonline.com/${GUID}/oauth2/v2.0/token`);
    expect(String(calls[0].init?.body)).toContain("scope=https%3A%2F%2Forg.crm4.dynamics.com%2F.default");
    expect(calls[0].init?.redirect).toBe("manual");
  });
  it("maps Entra errors to a helpful message without leaking the secret", async () => {
    const { f } = mockFetch(() => ({ status: 401, body: { error: "invalid_client", error_description: `AADSTS7000215: Invalid client secret provided ${SECRET}` } }));
    const e = (await getAccessToken(cfg, f).catch((x) => x)) as DataverseError;
    expect(e).toBeInstanceOf(DataverseError);
    expect(e.message).toMatch(/secret VALUE/);
    expect(e.message).not.toContain(SECRET);
  });
  it("refuses to follow a next link that leaves the environment", async () => {
    const { f } = mockFetch((u) => tokenOk(u) ?? (u.includes("/solutions") ? { body: { value: [], "@odata.nextLink": "https://evil.example/api/data/v9.2/solutions" } } : { body: { value: [] } }));
    await expect(verifyTargets(cfg, [{ type: 1, key: "account" }], f)).rejects.toThrow(/left the environment/);
  });
  it("reports what the application user can read when testing", async () => {
    const { f } = mockFetch((u) => tokenOk(u) ?? (u.includes("WhoAmI") ? { body: { UserId: GUID } } : u.includes("RetrieveVersion") ? { body: { Version: "9.2.1" } } : u.includes("solutions") ? { status: 403 } : { body: { value: [] } }));
    expect(await testConnection(cfg, f)).toEqual({ version: "9.2.1", canReadMetadata: true, canReadSolutions: false });
  });
  it("classifies tables, columns, web resources and flows as present / absent / unchecked", async () => {
    const wf = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const { f, calls } = mockFetch((u) => {
      if (tokenOk(u)) return tokenOk(u)!;
      if (u.includes("/solutions?")) return { body: { value: [{ uniquename: "base", version: "1.2.0.0" }] } };
      if (u.endsWith("EntityDefinitions?$select=LogicalName")) return { body: { value: [{ LogicalName: "account" }, { LogicalName: "new_thing" }] } };
      if (u.includes("EntityDefinitions(LogicalName='new_thing')/Attributes")) return { body: { value: [{ LogicalName: "new_name" }] } };
      if (u.includes("webresourceset")) return { body: { value: [{ name: "new_/app.js" }] } };
      if (u.includes("/workflows?")) return { body: { value: [] } };
      return { status: 404 };
    });
    const r = await verifyTargets(cfg, [
      { type: 1, key: "new_thing" }, { type: 1, key: "new_gone" }, { type: 2, key: "new_thing.new_name" }, { type: 2, key: "new_thing.new_other" },
      { type: 61, key: "new_/app.js" }, { type: 61, key: "new_/missing.js" }, { type: 29, key: wf }, { type: 29, key: "not-a-guid" }, { type: 5000, key: "x" },
    ], f);
    expect(r.checks["1:new_thing"]).toBe("present");
    expect(r.checks["1:new_gone"]).toBe("absent");
    expect(r.checks["2:new_thing.new_name"]).toBe("present");
    expect(r.checks["2:new_thing.new_other"]).toBe("absent");
    expect(r.checks["61:new_/app.js"]).toBe("present");
    expect(r.checks["61:new_/missing.js"]).toBe("absent");
    expect(r.checks[`29:${wf}`]).toBe("absent");
    expect(r.checks["29:not-a-guid"]).toBe("unchecked");
    expect(r.checks["5000:x"]).toBe("unchecked");
    expect(r.installed).toEqual([{ name: "base", version: "1.2.0.0" }]);
    expect(calls.every((c) => (c.init?.method ?? "GET") === "GET" || c.url.includes("oauth2"))).toBe(true);
  });
  it("leaves a group unchecked (with a warning) when the app user lacks permission", async () => {
    const { f } = mockFetch((u) => tokenOk(u) ?? (u.includes("webresourceset") ? { status: 403 } : { body: { value: [] } }));
    const r = await verifyTargets(cfg, [{ type: 61, key: "new_/a.js" }], f);
    expect(r.checks["61:new_/a.js"]).toBe("unchecked");
    expect(r.warnings.join(" ")).toMatch(/webresourceset/);
  });
  it("never builds a filter from a name containing quotes or other unexpected characters", async () => {
    const { f, calls } = mockFetch((u) => tokenOk(u) ?? { body: { value: [] } });
    const r = await verifyTargets(cfg, [{ type: 80, key: "app'x or 1 eq 1" }], f);
    expect(r.checks["80:app'x or 1 eq 1"]).toBe("unchecked");
    expect(calls.some((c) => c.url.includes("appmodules"))).toBe(false);
  });
});

const sol = (over: Partial<ParsedSolution>): ParsedSolution => ({
  uniqueName: "mine", friendlyName: "Mine", version: "1.0.0.0", managed: false, parentSolutionName: null, publisher: null,
  rootComponents: [], inventory: [], missingDependencies: [], entities: [], references: [], ...over,
} as unknown as ParsedSolution);

describe("applying a target check to missing rows (0.12.0)", () => {
  const s = sol({ missingDependencies: [{ requiredType: "1", requiredName: "new_thing", requiredKey: "new_thing", requiredSolution: "base (2.0.0.0)", requiredSolutionName: "base", requiredSolutionVersion: "2.0.0.0", dependentType: "26", dependentName: "A view" }] } as Partial<ParsedSolution>);
  it("collects numeric-typed manifest components as targets", () => {
    expect(collectTargets(s, [])).toEqual([{ type: 1, key: "new_thing" }]);
  });
  it("marks present rows as info and notes the installed solution version", () => {
    const rows = buildMissingRows(s, [], []);
    const result: TargetResult = { environment: "Prod", checkedAt: "2026-01-01T00:00:00Z", checks: { "1:new_thing": "present" }, installed: [{ name: "base", version: "1.2.0.0" }], checkedCount: 1, warnings: [] };
    const [r] = applyTargetResult(rows, result);
    expect(r.target?.state).toBe("present");
    expect(r.severity).toBe("info");
    expect(r.target?.note).toMatch(/older than the required 2\.0\.0\.0/);
    expect(r.fix).toMatch(/Already exists in Prod/);
  });
  it("marks absent rows and keeps severity; unchecked rows are untouched", () => {
    const rows = buildMissingRows(s, [], []);
    const base: TargetResult = { environment: "Prod", checkedAt: "x", checks: { "1:new_thing": "absent" }, installed: [], checkedCount: 1, warnings: [] };
    const [a] = applyTargetResult(rows, base);
    expect(a.target?.state).toBe("absent"); expect(a.severity).toBe("error"); expect(a.target?.note).toMatch(/not installed/);
    const [u] = applyTargetResult(rows, { ...base, checks: {}, installed: [{ name: "base", version: "2.0.0.0" }] });
    expect(u.target?.state).toBe("unchecked");
    expect(applyTargetResult(rows, null)).toBe(rows);
  });
});
