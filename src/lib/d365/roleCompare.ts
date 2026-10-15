import type { AccessLevel, ParsedRole } from "./types";

/** Compare two security roles privilege by privilege (table x verb), regardless of which solution each came from. */
export const VERBS = ["create", "read", "write", "delete", "append", "appendto", "assign", "share"] as const;
export type Verb = (typeof VERBS)[number];
export const LVL_RANK: Record<AccessLevel, number> = { none: 0, user: 1, bu: 2, deep: 3, org: 4 };

export type RoleRowStatus = "same" | "different" | "only-a" | "only-b";
export interface RoleDiffRow {
  table: string;
  status: RoleRowStatus;
  /** verbs whose level differs */
  diffs: Verb[];
  a: Record<Verb, AccessLevel>;
  b: Record<Verb, AccessLevel>;
  /** how many verbs B grants more / less than A on this table */
  moreInB: number;
  lessInB: number;
}
export interface RoleDiff {
  rows: RoleDiffRow[];
  summary: { tables: number; same: number; different: number; onlyA: number; onlyB: number; privilegesMoreInB: number; privilegesLessInB: number; orgPrivilegesA: number; orgPrivilegesB: number };
}

const levelsOf = (pv: Record<string, AccessLevel> | undefined): Record<Verb, AccessLevel> =>
  Object.fromEntries(VERBS.map((v) => [v, (pv?.[v] ?? "none") as AccessLevel])) as Record<Verb, AccessLevel>;
const hasAny = (l: Record<Verb, AccessLevel>) => VERBS.some((v) => l[v] !== "none");

export function diffRoles(a: ParsedRole, b: ParsedRole): RoleDiff {
  const tables = [...new Set([...Object.keys(a.privileges), ...Object.keys(b.privileges)])].sort();
  const rows: RoleDiffRow[] = [];
  const s = { tables: 0, same: 0, different: 0, onlyA: 0, onlyB: 0, privilegesMoreInB: 0, privilegesLessInB: 0, orgPrivilegesA: 0, orgPrivilegesB: 0 };
  for (const table of tables) {
    const la = levelsOf(a.privileges[table]), lb = levelsOf(b.privileges[table]);
    const ha = hasAny(la), hb = hasAny(lb);
    if (!ha && !hb) continue; // listed with nothing granted on both sides
    const diffs = VERBS.filter((v) => la[v] !== lb[v]);
    const moreInB = diffs.filter((v) => LVL_RANK[lb[v]] > LVL_RANK[la[v]]).length;
    const lessInB = diffs.length - moreInB;
    const status: RoleRowStatus = !diffs.length ? "same" : ha && !hb ? "only-a" : !ha && hb ? "only-b" : "different";
    rows.push({ table, status, diffs, a: la, b: lb, moreInB, lessInB });
    s.tables++; s.privilegesMoreInB += moreInB; s.privilegesLessInB += lessInB;
    if (status === "same") s.same++; else if (status === "different") s.different++; else if (status === "only-a") s.onlyA++; else s.onlyB++;
    s.orgPrivilegesA += VERBS.filter((v) => la[v] === "org").length;
    s.orgPrivilegesB += VERBS.filter((v) => lb[v] === "org").length;
  }
  return { rows, summary: s };
}
