import { authorityHost, normalizeEnvironmentUrl, type ConnectionInput } from "../d365/environment";
import { buildClientAssertion } from "./certificate";
import type { TargetItem, TargetResult, TargetState } from "../d365/targetCheck";
import { MAX_TARGETS, targetId } from "../d365/targetCheck";
import { log } from "./log";

/**
 * Read-only client for the Dataverse Web API (OData v4.0). Microsoft-supported auth: Microsoft Entra
 * client-credentials with an application user in the environment. Only GET requests are ever sent; the target host
 * is re-validated on every use; redirects are never followed; responses are never stored by this module.
 */
export type Fetch = typeof fetch;
export type DvConfig = Pick<ConnectionInput, "environmentUrl" | "tenantId" | "clientId" | "authType" | "clientSecret" | "privateKeyPem" | "certificatePem">;

/** Message is safe to show the user (never contains the secret or a token). */
export class DataverseError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

const API = "/api/data/v9.2/";
const TIMEOUT_MS = 20_000;
const AAD_HINTS: Record<string, string> = {
  AADSTS7000215: "Microsoft Entra rejected the client secret. Paste the secret VALUE (not the secret ID) of your app registration.",
  AADSTS7000222: "The client secret has expired. Create a new secret and save the connection again.",
  AADSTS700016: "The application (client) ID was not found in that tenant. Check the client ID and tenant ID.",
  AADSTS90002: "The tenant was not found. Check the tenant ID.",
  AADSTS700027: "Microsoft Entra could not verify the certificate. Upload the public certificate (.cer) of this connection to the app registration (Certificates & secrets > Certificates) and wait a minute.",
  AADSTS700024: "The sign-in assertion was rejected as expired. Check that this server's clock is correct, then try again.",
  AADSTS1002016: "Microsoft Entra rejected the certificate algorithm. Delete and re-add the connection to generate a new certificate.",
  AADSTS500011: "The environment URL was not recognised as a resource in this tenant. Check the environment URL.",
};

export async function getAccessToken(cfg: DvConfig, f: Fetch = fetch): Promise<string> {
  const origin = normalizeEnvironmentUrl(cfg.environmentUrl);
  const url = `https://${authorityHost(origin)}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`;
  let credential: Record<string, string>;
  if (cfg.authType === "certificate") {
    if (!cfg.privateKeyPem || !cfg.certificatePem) throw new DataverseError("This connection has no certificate. Delete it and add it again.", 400);
    credential = { client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: buildClientAssertion({ clientId: cfg.clientId, audience: url, privateKeyPem: cfg.privateKeyPem, certificatePem: cfg.certificatePem }) };
  } else {
    if (!cfg.clientSecret) throw new DataverseError("This connection has no client secret. Delete it and add it again.", 400);
    credential = { client_secret: cfg.clientSecret };
  }
  let res: Response;
  try {
    res = await f(url, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.clientId, scope: `${origin}/.default`, ...credential }),
    });
  } catch { throw new DataverseError("Could not reach Microsoft Entra. Try again in a moment."); }
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    const code = /AADSTS\d+/.exec(body.error_description ?? "")?.[0];
    log.warn("dataverse_token_failed", { status: res.status, code });
    throw new DataverseError((code && AAD_HINTS[code]) || `Microsoft Entra sign-in failed${code ? ` (${code})` : ` (HTTP ${res.status})`}.`, 400);
  }
  return body.access_token;
}

export interface DvClient { get: <T = unknown>(path: string) => Promise<{ status: number; body?: T }> }

export function createClient(cfg: DvConfig, token: string, f: Fetch = fetch): DvClient {
  const origin = normalizeEnvironmentUrl(cfg.environmentUrl);
  return {
    async get<T>(path: string) {
      const url = path.startsWith("https://") ? path : `${origin}${API}${path}`;
      if (!url.startsWith(`${origin}${API}`)) throw new DataverseError("Refused a response link that left the environment.");
      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await f(url, {
            method: "GET", redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "OData-MaxVersion": "4.0", "OData-Version": "4.0", Prefer: "odata.maxpagesize=1000" },
          });
        } catch { throw new DataverseError("Could not reach the Dynamics 365 environment. Check the URL and try again."); }
        if ((res.status === 429 || res.status === 503) && attempt < 1) {
          const wait = Math.min(Number(res.headers.get("retry-after")) || 2, 5);
          await new Promise((r) => setTimeout(r, wait * 1000));
          continue;
        }
        if (res.status >= 300 && res.status < 400) throw new DataverseError("The environment answered with a redirect, which is not followed.");
        if (res.status === 200) return { status: 200, body: (await res.json().catch(() => undefined)) as T | undefined };
        return { status: res.status };
      }
    },
  };
}

const ok = (status: number) => status === 200;
const denied = (status: number) => status === 401 || status === 403;

export interface TestResult { version?: string; canReadMetadata: boolean; canReadSolutions: boolean }
export async function testConnection(cfg: DvConfig, f: Fetch = fetch): Promise<TestResult> {
  const c = createClient(cfg, await getAccessToken(cfg, f), f);
  const who = await c.get("WhoAmI");
  if (denied(who.status)) throw new DataverseError("Signed in, but the application user was not accepted by this environment. Add the app registration as an application user (Power Platform admin center > Environment > Settings > Users + permissions > Application users) with a security role.", 403);
  if (!ok(who.status)) throw new DataverseError(`The environment answered WhoAmI with HTTP ${who.status}. Check the environment URL.`);
  const [ver, meta, sol] = await Promise.all([c.get<{ Version?: string }>("RetrieveVersion"), c.get("EntityDefinitions?$select=LogicalName&$top=1"), c.get("solutions?$select=uniquename&$top=1")]);
  return { version: ver.body?.Version, canReadMetadata: ok(meta.status), canReadSolutions: ok(sol.status) };
}

/* ---------------- existence checks ---------------- */

const odataStr = (v: string) => v.replace(/'/g, "''");
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME = /^[A-Za-z0-9_.\-$ /]{1,200}$/;
const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** type code -> [entity set, field, key kind] for components found by one filtered query */
const BY_FILTER: Record<number, { set: string; field: string; guid: boolean }> = {
  61: { set: "webresourceset", field: "name", guid: false },
  29: { set: "workflows", field: "workflowid", guid: true },
  80: { set: "appmodules", field: "uniquename", guid: false },
  380: { set: "environmentvariabledefinitions", field: "schemaname", guid: false },
  9001: { set: "connectionreferences", field: "connectionreferencelogicalname", guid: false },
  20: { set: "roles", field: "roleid", guid: true },
  26: { set: "savedqueries", field: "savedqueryid", guid: true },
  60: { set: "systemforms", field: "formid", guid: true },
  59: { set: "savedqueryvisualizations", field: "savedqueryvisualizationid", guid: true },
  62: { set: "sitemaps", field: "sitemapid", guid: true },
  91: { set: "pluginassemblies", field: "name", guid: false },
};

async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

export async function verifyTargets(cfg: DvConfig, items: TargetItem[], f: Fetch = fetch): Promise<TargetResult> {
  const origin = normalizeEnvironmentUrl(cfg.environmentUrl);
  const c = createClient(cfg, await getAccessToken(cfg, f), f);
  const checks: Record<string, TargetState> = {};
  const warnings: string[] = [];
  const set = (t: number, k: string, s: TargetState) => { checks[targetId(t, k)] = s; };
  const todo = items.slice(0, MAX_TARGETS);
  if (items.length > MAX_TARGETS) warnings.push(`Only the first ${MAX_TARGETS} components were checked.`);
  for (const i of todo) set(i.type, i.key, "unchecked");

  // installed solutions (name + version)
  const installed: TargetResult["installed"] = [];
  try {
    let next: string | undefined = "solutions?$select=uniquename,version&$filter=isvisible eq true";
    for (let page = 0; next && page < 5; page++) {
      const r: { status: number; body?: { value?: { uniquename: string; version: string }[]; "@odata.nextLink"?: string } } = await c.get(next);
      if (!ok(r.status)) { warnings.push(denied(r.status) ? "The application user cannot read installed solutions (needs Read on Solution)." : `Installed solutions could not be read (HTTP ${r.status}).`); break; }
      for (const s of r.body?.value ?? []) installed.push({ name: s.uniquename, version: s.version });
      next = r.body?.["@odata.nextLink"];
    }
  } catch (e) { if (e instanceof DataverseError) throw e; }

  // tables
  const tables = todo.filter((i) => i.type === 1);
  const cols = todo.filter((i) => i.type === 2);
  if (tables.length || cols.length) {
    const r = await c.get<{ value?: { LogicalName: string }[] }>("EntityDefinitions?$select=LogicalName");
    if (ok(r.status)) {
      const have = new Set((r.body?.value ?? []).map((e) => e.LogicalName.toLowerCase()));
      for (const t of tables) set(t.type, t.key, have.has(t.key.toLowerCase()) ? "present" : "absent");
      const byTable = new Map<string, TargetItem[]>();
      for (const col of cols) { const [t] = col.key.split("."); (byTable.get(t.toLowerCase()) ?? byTable.set(t.toLowerCase(), []).get(t.toLowerCase())!).push(col); }
      const tableList = [...byTable.keys()].slice(0, 40);
      if (byTable.size > tableList.length) warnings.push("Columns were checked for the first 40 tables only.");
      await pool(tableList, 4, async (t) => {
        if (!have.has(t) || !NAME.test(t)) { if (!have.has(t)) for (const col of byTable.get(t)!) set(col.type, col.key, "absent"); return; }
        const a = await c.get<{ value?: { LogicalName: string }[] }>(`EntityDefinitions(LogicalName='${odataStr(t)}')/Attributes?$select=LogicalName`);
        if (!ok(a.status)) return;
        const attrs = new Set((a.body?.value ?? []).map((x) => x.LogicalName.toLowerCase()));
        for (const col of byTable.get(t)!) set(col.type, col.key, attrs.has((col.key.split(".")[1] ?? "").toLowerCase()) ? "present" : "absent");
      });
    } else warnings.push(denied(r.status) ? "The application user cannot read table metadata." : `Table metadata could not be read (HTTP ${r.status}).`);
  }

  // everything else: one filtered query per ~12 keys
  for (const [typeStr, spec] of Object.entries(BY_FILTER)) {
    const type = Number(typeStr);
    const group = todo.filter((i) => i.type === type && (spec.guid ? GUID.test(i.key) : NAME.test(i.key)));
    if (!group.length) continue;
    const found = new Set<string>();
    let failed = false;
    for (const part of chunks(group, 12)) {
      const filter = part.map((i) => (spec.guid ? `${spec.field} eq ${i.key.toLowerCase()}` : `${spec.field} eq '${odataStr(i.key)}'`)).join(" or ");
      const r = await c.get<{ value?: Record<string, unknown>[] }>(`${spec.set}?$select=${spec.field}&$filter=${encodeURIComponent(filter)}`);
      if (!ok(r.status)) { failed = true; warnings.push(denied(r.status) ? `The application user cannot read ${spec.set} (needs Read on that table).` : `${spec.set} could not be read (HTTP ${r.status}).`); break; }
      for (const row of r.body?.value ?? []) found.add(String(row[spec.field]).toLowerCase());
    }
    if (!failed) for (const i of group) set(i.type, i.key, found.has(i.key.toLowerCase()) ? "present" : "absent");
  }

  const checkedCount = Object.values(checks).filter((s) => s !== "unchecked").length;
  return { environment: new URL(origin).hostname.split(".")[0], checkedAt: new Date().toISOString(), checks, installed, checkedCount, warnings };
}
