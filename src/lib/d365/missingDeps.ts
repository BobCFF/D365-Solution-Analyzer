import { componentTypeName } from "./componentTypes";
import type { ResolvedRef } from "./dependencies";
import type { ParsedSolution } from "./types";

/** solution.xml writes solution references as "UniqueName (1.0.0.0)". */
export function parseSolutionRef(ref: string): { name: string; version: string } {
  const m = /^(.*?)\s*\(\s*(\d+(?:\.\d+){1,3})\s*\)\s*$/.exec(ref.trim());
  return m ? { name: m[1].trim(), version: m[2] } : { name: ref.trim(), version: "" };
}

/** Component type as a readable label: numeric codes ("1") map to names; text ("Entity") is kept. */
export function typeLabel(t: string): string {
  const n = Number(t);
  return t !== "" && Number.isInteger(n) ? componentTypeName(n) : t || "Component";
}

const KIND_LABEL: Record<string, string> = {
  "nav-table": "Navigation item", "nav-webresource": "Navigation link", "nav-icon": "Navigation icon", "nav-dashboard": "Navigation dashboard",
  "nav-privilege": "Navigation privilege", "app-component": "App component", "app-role": "App role", "form-table": "Form", "form-webresource": "Form script",
  "form-column": "Form field", "form-view": "Form view", "flow-connref": "Flow connection", "flow-envvar": "Flow variable", "flow-child": "Child flow",
  "webresource-ref": "Ribbon / other", "role-table": "Security role privilege", "lookup-target": "Lookup target", "column-table": "Column of table",
};

export interface MissingRow {
  id: string;
  /** manifest = reported by the platform in solution.xml; scan = found by this tool's reference scan */
  source: "manifest" | "scan";
  /** missing = confirmed absent from everything loaded; verify = could be a system component */
  status: "missing" | "verify";
  severity: "error" | "warning" | "info";
  requiredType: string;
  /** numeric component type code when known (used to look the component up in a real environment) */
  requiredTypeCode?: number;
  requiredName: string;
  requiredKey?: string;
  requiredParent?: string;
  requiredSolution?: string;
  requiredSolutionVersion?: string;
  dependentType: string;
  dependentName: string;
  where?: string;
  relation?: string;
  /** manifest rows: is the required solution loaded in this workspace? */
  availability: "loaded" | "not-loaded" | "unknown";
  /** result of checking this component against a connected Dynamics 365 environment (see targetCheck.ts) */
  target?: { state: "present" | "absent" | "unchecked"; note?: string };
  fix: string;
}

/**
 * One parsed row per missing dependency: the platform's own MissingDependencies from solution.xml (authoritative about
 * the source environment) merged with the reference scan (navigation, forms, apps, flows, roles, schema), de-duplicated.
 */
export function buildMissingRows(sol: ParsedSolution, resolved: ResolvedRef[] | null, loadedSolutions: string[] | null, includeVerify = false): MissingRow[] {
  const loaded = new Set((loadedSolutions ?? []).map((s) => s.toLowerCase()));
  const rows: MissingRow[] = [];
  const seen = new Set<string>();

  for (const [i, m] of sol.missingDependencies.entries()) {
    const name = m.requiredSolutionName ?? parseSolutionRef(m.requiredSolution).name;
    const version = m.requiredSolutionVersion ?? parseSolutionRef(m.requiredSolution).version;
    const key = `${typeLabel(m.requiredType)}|${(m.requiredKey ?? m.requiredName).toLowerCase()}|${m.dependentName.toLowerCase()}`;
    seen.add(key); seen.add(`${typeLabel(m.requiredType)}|${(m.requiredKey ?? m.requiredName).toLowerCase()}|*`);
    const isLoaded = name ? loaded.has(name.toLowerCase()) : false;
    rows.push({
      id: `m${i}`, source: "manifest", status: "missing", severity: "error",
      requiredType: typeLabel(m.requiredType), requiredTypeCode: m.requiredType !== "" && Number.isInteger(Number(m.requiredType)) ? Number(m.requiredType) : undefined, requiredName: m.requiredName, requiredKey: m.requiredKey, requiredParent: m.requiredParent,
      requiredSolution: name || undefined, requiredSolutionVersion: version || undefined,
      dependentType: typeLabel(m.dependentType), dependentName: m.dependentName,
      availability: !name ? "unknown" : loadedSolutions === null ? "unknown" : isLoaded ? "loaded" : "not-loaded",
      fix: name
        ? `${isLoaded ? "Import" : "Load and import"} solution "${name}"${version ? ` (${version} or later)` : ""} into the target before this one, or add the component to this solution.`
        : "Add the required component to this solution (Add required objects) or import the solution that provides it first.",
    });
  }

  for (const [i, r] of (resolved ?? []).entries()) {
    const verify = r.status === "unverifiable";
    if (r.status !== "missing" && !(includeVerify && verify)) continue;
    const reqType = componentTypeName(r.ref.to.type);
    const key = `${reqType}|${r.ref.to.key.toLowerCase()}|${(r.ref.from.name ?? r.ref.from.key).toLowerCase()}`;
    if (seen.has(key) || seen.has(`${reqType}|${r.ref.to.key.toLowerCase()}|*`)) continue; // already reported by the platform
    seen.add(key);
    const soft = r.ref.to.type === 9001 || r.ref.to.type === 380;
    rows.push({
      id: `s${i}`, source: "scan", status: verify ? "verify" : "missing", severity: verify ? "info" : soft ? "warning" : "error",
      requiredType: reqType, requiredTypeCode: r.ref.to.type, requiredName: r.ref.to.key, requiredKey: r.ref.to.key,
      dependentType: componentTypeName(r.ref.from.type), dependentName: r.ref.from.name || r.ref.from.key, where: r.ref.detail, relation: KIND_LABEL[r.ref.kind] ?? r.ref.kind,
      availability: "unknown",
      fix: verify
        ? "Not in this package; confirm it exists in the target (it may be a system component) or add it to the solution."
        : soft ? "Include it in the solution, or make sure it exists in the target before import (deployment settings file for values)."
        : "Add the component to this solution, or import the solution that defines it first. It is not in any loaded solution.",
    });
  }
  const sev = { error: 0, warning: 1, info: 2 };
  return rows.sort((a, b) => sev[a.severity] - sev[b.severity] || a.requiredType.localeCompare(b.requiredType) || a.requiredName.localeCompare(b.requiredName));
}
