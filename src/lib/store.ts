import { listConnections } from "./connections";
import { analyzeSolution } from "./d365/analyzer";
import type { Finding, ParsedSolution } from "./d365/types";
import type { Ctx } from "./server/auth";
import { DecryptionError, mac, sealJson, unsealJson } from "./server/crypto";
import { log } from "./server/log";
import { APP_VERSION } from "./version";

/** Everything here talks to Postgres only in sealed form; see src/lib/server/crypto.ts and the encrypted_storage migration. */

export interface SolutionMeta {
  uniqueName: string; friendlyName: string; version: string; managed: boolean;
  parentSolutionName: string | null; publisherName: string | null; publisherPrefix: string | null; fileName: string;
}
export interface SolutionSummary { id: string; unique_name: string; friendly_name: string; version: string; managed: boolean; parent_solution_name: string | null; publisher_prefix: string | null; file_name: string; created_at: string }
export interface FindingPayload { title: string; detail: string; remediation: string | null; componentKey: string | null; solutions?: string[] }

const metaOf = (p: ParsedSolution, fileName: string): SolutionMeta => ({
  uniqueName: p.uniqueName, friendlyName: p.friendlyName, version: p.version, managed: p.managed, parentSolutionName: p.parentSolutionName,
  publisherName: p.publisher?.uniqueName ?? null, publisherPrefix: p.publisher?.customizationPrefix ?? null, fileName,
});

export async function logChange(ctx: Ctx, action: "upload" | "analyze" | "compare" | "delete" | "purge" | "connect" | "verify", entity: string, entityId: string | null, summary: string) {
  await ctx.db.from("change_log").insert({ action, entity, entity_id: entityId, summary: sealJson(ctx.userId, "log.summary", summary), app_version: APP_VERSION });
}

export async function readLog(ctx: Ctx) {
  const { data, error } = await ctx.db.from("change_log").select("id, action, summary, app_version, created_at").order("created_at", { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ ...r, summary: unsealJson<string>(ctx.userId, "log.summary", r.summary) }));
}

/** Rows that cannot be decrypted (wrong/rotated-away key) are counted, not fatal: one bad row must not break the app. */
export async function listSolutions(ctx: Ctx): Promise<{ solutions: SolutionSummary[]; unreadable: number }> {
  const { data, error } = await ctx.db.from("solutions").select("id, meta, created_at").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const solutions: SolutionSummary[] = [];
  let unreadable = 0;
  for (const r of data ?? []) {
    try {
      const m = unsealJson<SolutionMeta>(ctx.userId, "solution.meta", r.meta);
      solutions.push({ id: r.id, unique_name: m.uniqueName, friendly_name: m.friendlyName, version: m.version, managed: m.managed, parent_solution_name: m.parentSolutionName, publisher_prefix: m.publisherPrefix, file_name: m.fileName, created_at: r.created_at });
    } catch (e) {
      if (!(e instanceof DecryptionError)) throw e;
      unreadable++;
    }
  }
  if (unreadable) log.warn("unreadable_rows", { table: "solutions", count: unreadable });
  return { solutions, unreadable };
}

export async function countSolutions(ctx: Ctx): Promise<number> {
  const { count, error } = await ctx.db.from("solutions").select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function getSolution(ctx: Ctx, id: string): Promise<{ id: string; meta: SolutionMeta; parsed: ParsedSolution; created_at: string } | null> {
  const { data, error } = await ctx.db.from("solutions").select("id, meta, parsed, created_at").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { id: data.id, created_at: data.created_at, meta: unsealJson<SolutionMeta>(ctx.userId, "solution.meta", data.meta), parsed: unsealJson<ParsedSolution>(ctx.userId, "solution.parsed", data.parsed) };
}

export async function loadParsed(ctx: Ctx, exceptId?: string): Promise<{ id: string; parsed: ParsedSolution }[]> {
  let q = ctx.db.from("solutions").select("id, parsed");
  if (exceptId) q = q.neq("id", exceptId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const out: { id: string; parsed: ParsedSolution }[] = [];
  for (const r of data ?? []) {
    try { out.push({ id: r.id as string, parsed: unsealJson<ParsedSolution>(ctx.userId, "solution.parsed", r.parsed) }); }
    catch (e) { if (!(e instanceof DecryptionError)) throw e; log.warn("unreadable_rows", { table: "solutions", id: r.id }); }
  }
  return out;
}

export async function readFindings(ctx: Ctx, solutionId: string) {
  const { data, error } = await ctx.db.from("analysis_findings").select("id, rule_id, severity, payload").eq("solution_id", solutionId).order("id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const p = unsealJson<FindingPayload>(ctx.userId, "finding.payload", r.payload);
    return { id: r.id, rule_id: r.rule_id, severity: r.severity, title: p.title, detail: p.detail, remediation: p.remediation, solutions: p.solutions ?? [] };
  });
}

export async function saveFindings(ctx: Ctx, solutionId: string, findings: Finding[]) {
  const del = await ctx.db.from("analysis_findings").delete().eq("solution_id", solutionId);
  if (del.error) throw new Error(del.error.message);
  if (!findings.length) return;
  const { error } = await ctx.db.from("analysis_findings").insert(findings.map((f) => ({
    solution_id: solutionId, rule_id: f.ruleId, severity: f.severity,
    payload: sealJson(ctx.userId, "finding.payload", { title: f.title, detail: f.detail, remediation: f.remediation ?? null, componentKey: f.componentKey ?? null, solutions: f.solutions ?? [] } satisfies FindingPayload),
  })));
  if (error) throw new Error(error.message);
}

export async function analyzeAndStore(ctx: Ctx, solutionId: string, parsed: ParsedSolution) {
  const others = (await loadParsed(ctx, solutionId)).map((o) => o.parsed);
  const findings = analyzeSolution(parsed, { others });
  await saveFindings(ctx, solutionId, findings);
  return findings;
}

export async function insertSolution(ctx: Ctx, parsed: ParsedSolution, fileName: string, fileSha256: string) {
  const meta = metaOf(parsed, fileName);
  const { data, error } = await ctx.db.from("solutions").insert({
    unique_key: mac(ctx.userId, "unique", `${parsed.uniqueName.toLowerCase()}|${parsed.version}|${parsed.managed}`),
    meta: sealJson(ctx.userId, "solution.meta", meta),
    parsed: sealJson(ctx.userId, "solution.parsed", parsed),
    file_hmac: mac(ctx.userId, "file", fileSha256),
  }).select("id").single();
  if (error) throw new Error(error.code === "23505" ? "This solution name/version/managed state is already loaded." : error.message);
  return data.id as string;
}

export async function deleteSolution(ctx: Ctx, id: string) {
  const s = await getSolution(ctx, id).catch(() => null);
  const { error } = await ctx.db.from("solutions").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await logChange(ctx, "delete", "solution", id, `Deleted ${s?.meta.uniqueName ?? id} ${s?.meta.version ?? ""}`.trim());
}

/** Erase everything this user has stored (right to erasure). Leaves one sealed audit record of the purge itself. */
export async function purgeAll(ctx: Ctx) {
  for (const t of ["comparisons", "analysis_findings", "solutions", "d365_connections", "change_log"]) {
    const { error } = await ctx.db.from(t).delete().eq("owner_id", ctx.userId);
    if (error) throw new Error(error.message);
  }
  await logChange(ctx, "purge", "account", null, "All stored solutions, findings, comparisons, saved connections and history were deleted by the user");
}

/** Right of access / portability: everything stored for this user, decrypted, as one JSON document. */
export async function exportAll(ctx: Ctx) {
  const unseal = <T,>(purpose: string, v: string): T | null => { try { return unsealJson<T>(ctx.userId, purpose, v); } catch (e) { if (e instanceof DecryptionError) return null; throw e; } };
  const [con, sol, fnd, cmp, lg] = await Promise.all([
    listConnections(ctx).catch(() => ({ connections: [] })),
    ctx.db.from("solutions").select("id, meta, parsed, created_at"),
    ctx.db.from("analysis_findings").select("id, solution_id, rule_id, severity, payload, analyzed_at"),
    ctx.db.from("comparisons").select("id, left_solution_id, right_solution_id, result, created_at"),
    ctx.db.from("change_log").select("id, action, entity, entity_id, summary, app_version, created_at"),
  ]);
  for (const r of [sol, fnd, cmp, lg]) if (r.error) throw new Error(r.error.message);
  return {
    exportedAt: new Date().toISOString(), appVersion: APP_VERSION, account: { id: ctx.userId, email: ctx.email },
    solutions: (sol.data ?? []).map((r) => ({ id: r.id, createdAt: r.created_at, meta: unseal("solution.meta", r.meta), parsed: unseal("solution.parsed", r.parsed) })),
    findings: (fnd.data ?? []).map((r) => ({ id: r.id, solutionId: r.solution_id, ruleId: r.rule_id, severity: r.severity, analyzedAt: r.analyzed_at, ...(unseal<FindingPayload>("finding.payload", r.payload) ?? {}) })),
    comparisons: (cmp.data ?? []).map((r) => ({ id: r.id, left: r.left_solution_id, right: r.right_solution_id, createdAt: r.created_at, result: unseal("comparison.result", r.result) })),
    connections: con.connections.map(({ id, name, environmentUrl, tenantId, clientId, createdAt, authType, certThumbprint, certExpires }) => ({ id, name, environmentUrl, tenantId, clientId, createdAt, authType, certThumbprint, certExpires })), // client secrets and private keys are never exported
    history: (lg.data ?? []).map((r) => ({ id: r.id, action: r.action, entity: r.entity, entityId: r.entity_id, appVersion: r.app_version, createdAt: r.created_at, summary: unseal<string>("log.summary", r.summary) })),
  };
}
