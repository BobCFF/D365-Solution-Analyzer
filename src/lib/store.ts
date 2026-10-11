import { analyzeSolution } from "./d365/analyzer";
import type { Finding, ParsedSolution } from "./d365/types";
import type { Ctx } from "./server/auth";
import { mac, sealJson, unsealJson } from "./server/crypto";
import { APP_VERSION } from "./version";

/** Everything here talks to Postgres only in sealed form; see src/lib/server/crypto.ts and the encrypted_storage migration. */

export interface SolutionMeta {
  uniqueName: string; friendlyName: string; version: string; managed: boolean;
  parentSolutionName: string | null; publisherName: string | null; publisherPrefix: string | null; fileName: string;
}
export interface SolutionSummary { id: string; unique_name: string; friendly_name: string; version: string; managed: boolean; parent_solution_name: string | null; publisher_prefix: string | null; file_name: string; created_at: string }
export interface FindingPayload { title: string; detail: string; remediation: string | null; componentKey: string | null }

const metaOf = (p: ParsedSolution, fileName: string): SolutionMeta => ({
  uniqueName: p.uniqueName, friendlyName: p.friendlyName, version: p.version, managed: p.managed, parentSolutionName: p.parentSolutionName,
  publisherName: p.publisher?.uniqueName ?? null, publisherPrefix: p.publisher?.customizationPrefix ?? null, fileName,
});

export async function logChange(ctx: Ctx, action: "upload" | "analyze" | "compare" | "delete" | "purge", entity: string, entityId: string | null, summary: string) {
  await ctx.db.from("change_log").insert({ action, entity, entity_id: entityId, summary: sealJson(ctx.userId, "log.summary", summary), app_version: APP_VERSION });
}

export async function readLog(ctx: Ctx) {
  const { data, error } = await ctx.db.from("change_log").select("id, action, summary, app_version, created_at").order("created_at", { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ ...r, summary: unsealJson<string>(ctx.userId, "log.summary", r.summary) }));
}

export async function listSolutions(ctx: Ctx): Promise<SolutionSummary[]> {
  const { data, error } = await ctx.db.from("solutions").select("id, meta, created_at").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const m = unsealJson<SolutionMeta>(ctx.userId, "solution.meta", r.meta);
    return { id: r.id, unique_name: m.uniqueName, friendly_name: m.friendlyName, version: m.version, managed: m.managed, parent_solution_name: m.parentSolutionName, publisher_prefix: m.publisherPrefix, file_name: m.fileName, created_at: r.created_at };
  });
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
  return (data ?? []).map((r) => ({ id: r.id as string, parsed: unsealJson<ParsedSolution>(ctx.userId, "solution.parsed", r.parsed) }));
}

export async function readFindings(ctx: Ctx, solutionId: string) {
  const { data, error } = await ctx.db.from("analysis_findings").select("id, rule_id, severity, payload").eq("solution_id", solutionId).order("id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const p = unsealJson<FindingPayload>(ctx.userId, "finding.payload", r.payload);
    return { id: r.id, rule_id: r.rule_id, severity: r.severity, title: p.title, detail: p.detail, remediation: p.remediation };
  });
}

export async function saveFindings(ctx: Ctx, solutionId: string, findings: Finding[]) {
  const del = await ctx.db.from("analysis_findings").delete().eq("solution_id", solutionId);
  if (del.error) throw new Error(del.error.message);
  if (!findings.length) return;
  const { error } = await ctx.db.from("analysis_findings").insert(findings.map((f) => ({
    solution_id: solutionId, rule_id: f.ruleId, severity: f.severity,
    payload: sealJson(ctx.userId, "finding.payload", { title: f.title, detail: f.detail, remediation: f.remediation ?? null, componentKey: f.componentKey ?? null } satisfies FindingPayload),
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
  for (const t of ["comparisons", "analysis_findings", "solutions", "change_log"]) {
    const { error } = await ctx.db.from(t).delete().eq("owner_id", ctx.userId);
    if (error) throw new Error(error.message);
  }
  await logChange(ctx, "purge", "account", null, "All stored solutions, findings, comparisons and history were deleted by the user");
}
