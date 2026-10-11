import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { analyzeSolution } from "./d365/analyzer";
import { componentTypeName } from "./d365/componentTypes";
import type { Finding, ParsedSolution } from "./d365/types";
import { APP_VERSION } from "./version";

export async function logChange(db: SupabaseClient, action: string, entity: string, entityId: string | null, summary: string) {
  await db.from("change_log").insert({ action, entity, entity_id: entityId, summary, app_version: APP_VERSION });
}

export async function loadParsed(db: SupabaseClient, exceptId?: string): Promise<{ id: string; parsed: ParsedSolution }[]> {
  let q = db.from("solutions").select("id, parsed");
  if (exceptId) q = q.neq("id", exceptId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; parsed: ParsedSolution }[];
}

export async function saveFindings(db: SupabaseClient, solutionId: string, findings: Finding[]) {
  await db.from("analysis_findings").delete().eq("solution_id", solutionId);
  if (!findings.length) return;
  const { error } = await db.from("analysis_findings").insert(
    findings.map((f) => ({
      solution_id: solutionId, rule_id: f.ruleId, severity: f.severity, title: f.title,
      detail: f.detail, remediation: f.remediation ?? null, component_key: f.componentKey ?? null,
    })),
  );
  if (error) throw new Error(error.message);
}

export async function analyzeAndStore(db: SupabaseClient, solutionId: string, parsed: ParsedSolution) {
  const others = (await loadParsed(db, solutionId)).map((o) => o.parsed);
  const findings = analyzeSolution(parsed, { others });
  await saveFindings(db, solutionId, findings);
  return findings;
}

export async function insertSolution(db: SupabaseClient, parsed: ParsedSolution, fileName: string, bytes: Uint8Array) {
  const sha = createHash("sha256").update(bytes).digest("hex");
  const { data, error } = await db.from("solutions").insert({
    unique_name: parsed.uniqueName, friendly_name: parsed.friendlyName, version: parsed.version,
    managed: parsed.managed, parent_solution_name: parsed.parentSolutionName,
    publisher_unique_name: parsed.publisher?.uniqueName ?? null, publisher_prefix: parsed.publisher?.customizationPrefix ?? null,
    file_name: fileName, file_sha256: sha, parsed,
  }).select("id").single();
  if (error) throw new Error(error.code === "23505" ? "This solution name/version/managed state is already loaded." : error.message);
  const id = data.id as string;

  const comps = [
    ...parsed.rootComponents.map((rc) => ({ solution_id: id, component_type: rc.type, type_name: componentTypeName(rc.type), component_key: rc.key, behavior: rc.behavior })),
    ...parsed.inventory.map((i) => ({ solution_id: id, component_type: i.type, type_name: i.typeName, component_key: i.key, display_name: i.displayName ?? null, details: i.details ?? null })),
  ];
  if (comps.length) {
    const { error: e2 } = await db.from("solution_components").insert(comps);
    if (e2) throw new Error(e2.message);
  }
  return id;
}
