import { ck, type ResolvedRef } from "./dependencies";
import type { MissingRow } from "./missingDeps";
import type { ParsedSolution } from "./types";
import { compareVersions, parseVersion } from "./version";

/** A reference checked against a real Dataverse environment (read-only existence check). */
export type TargetState = "present" | "absent" | "unchecked";
export interface TargetItem { type: number; key: string }
export interface TargetResult {
  environment: string;
  checkedAt: string;
  checks: Record<string, TargetState>;
  installed: { name: string; version: string }[];
  checkedCount: number;
  warnings: string[];
}

export const MAX_TARGETS = 1500;
export const targetId = (type: number, key: string) => ck(type, key.replace(/^\{|\}$/g, ""));

/** What needs checking: scan references that nothing loaded provides, plus platform-reported missing components. */
export function collectTargets(sol: ParsedSolution, resolved: ResolvedRef[]): TargetItem[] {
  const seen = new Set<string>();
  const out: TargetItem[] = [];
  const add = (type: number, key: string) => {
    if (!Number.isInteger(type) || !key) return;
    const id = targetId(type, key);
    if (seen.has(id) || out.length >= MAX_TARGETS) return;
    seen.add(id); out.push({ type, key: key.replace(/^\{|\}$/g, "") });
  };
  for (const r of resolved) if (r.status === "missing" || r.status === "unverifiable") add(r.ref.to.type, r.ref.to.key);
  for (const m of sol.missingDependencies) {
    const t = Number(m.requiredType);
    if (m.requiredType !== "" && Number.isInteger(t)) add(t, m.requiredKey ?? m.requiredName);
  }
  return out;
}

/** Merge a target check into the missing-dependency rows: adds the "In target environment" state and adjusts severity/advice. */
export function applyTargetResult(rows: MissingRow[], result: TargetResult | null): MissingRow[] {
  if (!result) return rows;
  const installed = new Map(result.installed.map((s) => [s.name.toLowerCase(), s.version]));
  return rows.map((r) => {
    const state: TargetState = r.requiredTypeCode !== undefined ? (result.checks[targetId(r.requiredTypeCode, r.requiredKey ?? r.requiredName)] ?? "unchecked") : "unchecked";
    const notes: string[] = [];
    if (r.requiredSolution) {
      const have = installed.get(r.requiredSolution.toLowerCase());
      if (have === undefined) notes.push(`Solution "${r.requiredSolution}" is not installed in ${result.environment}.`);
      else {
        const a = parseVersion(have), b = r.requiredSolutionVersion ? parseVersion(r.requiredSolutionVersion) : null;
        notes.push(a && b && compareVersions(a, b) < 0 ? `Installed ${have} is older than the required ${r.requiredSolutionVersion}; upgrade it first.` : `Solution "${r.requiredSolution}" ${have} is installed.`);
      }
    }
    if (state === "unchecked" && !notes.length) return { ...r, target: { state } };
    if (state === "present") return { ...r, severity: "info" as const, target: { state, note: notes.join(" ") || undefined }, fix: `Already exists in ${result.environment}; no action needed for this component. ${r.fix}` };
    if (state === "absent") return { ...r, target: { state, note: notes.join(" ") || undefined }, fix: `Confirmed missing in ${result.environment}. ${r.fix}` };
    return { ...r, target: { state, note: notes.join(" ") || undefined } };
  });
}
