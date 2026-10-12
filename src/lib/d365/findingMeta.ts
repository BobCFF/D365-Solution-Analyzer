/** Heuristics for grouping findings and recognising Microsoft / platform ("system") solutions. */

/** Solutions that ship with the platform or Microsoft apps. Names are matched case-insensitively. */
const SYSTEM_EXACT = new Set([
  "default", "system", "active", "basic", "activitiescore", "activityfeedscore", "applicationcommon", "anchor", "appcommon",
  "crmhostedonly", "msdynce_", "solutionpackage", "mobileoffline", "tasksconnection", "dynamics365commonentities",
]);
const SYSTEM_PREFIX = ["msdyn", "mscrm", "msft", "microsoft", "msdynce", "mspp", "powerplatform", "power_platform", "dynamics365", "dynamics_365", "oneauthority", "universalresourcescheduling", "fieldservice", "customerservice", "salesenterprise", "cci", "connectorsplatform", "flowsplatform", "powerapps", "powerautomate", "cds", "environmentvariable"];

export function isSystemSolution(uniqueName: string): boolean {
  const n = uniqueName.trim().toLowerCase();
  if (!n) return false;
  if (SYSTEM_EXACT.has(n)) return true;
  return SYSTEM_PREFIX.some((p) => n.startsWith(p));
}

const CATEGORY: Record<string, string> = {
  PKG: "Package", VER: "Version", PUB: "Publisher", MAN: "Managed / unmanaged", DEP: "Dependencies", NAV: "Navigation",
  FLOW: "Flows", WF: "Workflows", PAT: "Patches", SEC: "Security roles", FLD: "Field security", REL: "Relationships",
  ATT: "Columns", LAY: "Layering overlaps", ENV: "Environment variables", DUP: "Duplicates",
};

export function categoryOf(ruleId: string): string {
  return CATEGORY[/^[A-Z]+/.exec(ruleId)?.[0] ?? ""] ?? "Other";
}
export const ALL_CATEGORIES = [...new Set(Object.values(CATEGORY))].sort();

export interface FilterableFinding {
  rule_id: string; severity: "error" | "warning" | "info"; title: string; detail: string; remediation: string | null; solutions?: string[];
}
export interface FindingFilter { severity?: "all" | "error" | "warning" | "info"; category?: string; q?: string; excluded?: ReadonlySet<string>; hideSystem?: boolean }

/**
 * A finding that refers to other solutions is kept when at least one of them is included (not individually excluded,
 * and not a Microsoft/system solution while hideSystem is on). Findings that refer to none are always kept.
 */
export function filterFindings<T extends FilterableFinding>(findings: T[], f: FindingFilter): T[] {
  const needle = (f.q ?? "").trim().toLowerCase();
  const included = (n: string) => !f.excluded?.has(n) && !(f.hideSystem && isSystemSolution(n));
  return findings.filter((x) =>
    (!x.solutions?.length || x.solutions.some(included)) &&
    (!f.severity || f.severity === "all" || x.severity === f.severity) &&
    (!f.category || categoryOf(x.rule_id) === f.category) &&
    (!needle || `${x.title} ${x.detail} ${x.rule_id} ${x.remediation ?? ""} ${(x.solutions ?? []).join(" ")}`.toLowerCase().includes(needle)));
}
