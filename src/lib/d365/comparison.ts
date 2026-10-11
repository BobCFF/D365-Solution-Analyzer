import { componentTypeName } from "./componentTypes";
import { ck, requirements, resolveReferences, type ResolvedRef } from "./dependencies";
import type { ParsedSolution } from "./types";

/**
 * Vocabulary follows Salesforce Analyzer's compare grid, source -> target:
 *   new       only in source (will be created in target)
 *   deleted   only in target (not in source)
 *   different in both, content differs
 *   same      identical
 */
export type DiffStatus = "new" | "deleted" | "different" | "same";
export const STATUS_LABEL: Record<DiffStatus, string> = { new: "New", deleted: "Deleted", different: "Different", same: "Identical" };
export const STATUS_ORDER: Record<DiffStatus, number> = { different: 0, new: 1, deleted: 2, same: 3 };

export interface Facet { hash: string; name: string; parent?: string; props: Record<string, string> }
export interface CompareRow {
  id: string;
  type: number;
  typeName: string;
  key: string;
  name: string;
  parent?: string;
  status: DiffStatus;
  changes: string[];
  src?: Facet;
  tgt?: Facet;
}
export interface Comparison {
  rows: CompareRow[];
  counts: Record<DiffStatus, number>;
  byId: Map<string, CompareRow>;
}

const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
function hashOf(v: unknown): string { // FNV-1a 32-bit over the stable JSON; collisions only matter for "same" detection
  const s = stable(v); let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16) + s.length.toString(16);
}
/** Facets whose value is a serialised blob: report "changed" rather than dumping JSON. */
const OPAQUE = new Set(["graph", "privileges", "permissions"]);
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

/** Normalised, comparable facets for every component we understand. */
export function facets(sol: ParsedSolution): Map<string, Facet & { type: number; key: string }> {
  const m = new Map<string, Facet & { type: number; key: string }>();
  const put = (type: number, key: string, name: string, props: Record<string, unknown>, parent?: string) => {
    const p = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : str(v)]));
    m.set(ck(type, key), { type, key, name: name || key, parent, props: p, hash: hashOf(p) });
  };
  for (const rc of sol.rootComponents) put(rc.type, rc.key, rc.key, { behavior: rc.behavior });
  for (const i of sol.inventory) {
    if (i.type === 1) continue; // tables come from entities (below) with richer facts
    const { attributes: _a, attributeCount: _c, ...rest } = (i.details ?? {}) as Record<string, unknown>;
    const prev = m.get(ck(i.type, i.key));
    put(i.type, i.key, i.displayName || i.key, { ...(prev?.props ?? {}), ...rest });
  }
  for (const e of sol.entities ?? []) {
    const prev = m.get(ck(1, e.logical));
    put(1, e.logical, e.display, { ...(prev?.props ?? {}), columns: e.attributes.length });
    for (const a of e.attributes) {
      put(2, `${e.logical}.${a.name}`, a.display || a.name, { type: a.type, required: a.required, custom: a.custom, secured: a.secured, audit: a.audit, optionSet: a.optionSet, maxLength: a.maxLength, format: a.format, lookupTo: a.targets }, ck(1, e.logical));
    }
  }
  for (const r of sol.relationships ?? []) put(10, r.name || `${r.referencing}.${r.attribute}`, r.name, { type: r.type, from: r.referencing, to: r.referenced, column: r.attribute });
  for (const r of sol.roles ?? []) put(20, r.id || r.name, r.name, { privileges: stable(r.privileges) });
  for (const p of sol.fieldProfiles ?? []) put(24, p.id || p.name, p.name, { permissions: stable(p.permissions) });
  for (const f of sol.flows ?? []) put(29, f.id, f.name, { state: f.stateCode, steps: f.nodes.length, graph: stable(f.nodes.map((n) => [n.id, n.type, n.operation, n.connector, n.branch, n.runAfter])), connectionRefs: f.connectionRefs, envVars: f.envVars, childFlows: f.childFlows });
  for (const a of sol.apps ?? []) put(80, a.uniqueName, a.name, { components: a.components.map((c) => `${c.type}:${c.key}`).sort(), roles: [...a.roles].sort() });
  for (const sm of sol.siteMaps ?? []) {
    const root = ck(62, sm.id || sm.name);
    put(62, sm.id || sm.name, sm.name, { areas: sm.areas.length });
    for (const a of sm.areas) for (const g of a.groups) for (const s of g.subAreas) {
      put(62, `${sm.id || sm.name}/${a.id}/${g.id}/${s.id}`, `${a.title} › ${g.title} › ${s.title}`, { entity: s.entity, url: s.url, icon: s.icon, dashboard: s.dashboard, privileges: s.privileges.map((p) => `${p.entity}:${p.privilege}`) }, root);
    }
  }
  return m;
}

export function compareSets(source: ParsedSolution, target: ParsedSolution): Comparison {
  const a = facets(source), b = facets(target);
  const rows: CompareRow[] = [];
  const mk = (id: string, s?: ReturnType<typeof facets> extends Map<string, infer V> ? V : never, t?: typeof s): CompareRow => {
    const ref = (s ?? t)!;
    let status: DiffStatus, changes: string[] = [];
    if (s && !t) status = "new"; else if (!s && t) status = "deleted";
    else if (s!.hash === t!.hash) status = "same";
    else {
      status = "different";
      for (const k of new Set([...Object.keys(s!.props), ...Object.keys(t!.props)])) {
        if (s!.props[k] === t!.props[k]) continue;
        changes.push(OPAQUE.has(k) ? `${k} changed` : `${k}: ${t!.props[k] || "—"} → ${s!.props[k] || "—"}`);
      }
      if (changes.length > 40) changes = [...changes.slice(0, 40), `… ${changes.length - 40} more`];
    }
    return { id, type: ref.type, typeName: componentTypeName(ref.type), key: ref.key, name: ref.name, parent: ref.parent, status, changes, src: s, tgt: t };
  };
  for (const [id, s] of a) rows.push(mk(id, s, b.get(id)));
  for (const [id, t] of b) if (!a.has(id)) rows.push(mk(id, undefined, t));
  const counts: Record<DiffStatus, number> = { new: 0, deleted: 0, different: 0, same: 0 };
  for (const r of rows) counts[r.status]++;
  return { rows, counts, byId: new Map(rows.map((r) => [r.id, r])) };
}

export interface SelectionReport {
  /** dependencies of the selection that are New/Different and not yet ticked: deploy them too */
  needed: CompareRow[];
  /** dependencies that exist nowhere (not in source, not in target): the deployment will fail or break */
  missing: { ref: ResolvedRef["ref"]; dependents: string[] }[];
  alreadyInTarget: number;
  unverifiable: number;
  truncated: boolean;
}

/**
 * Deploy-readiness for a set of ticked rows (source -> target), the D365 analogue of Salesforce Analyzer's
 * "Tick dependencies": walk what the selection requires and bucket each requirement.
 */
export function analyzeSelection(selected: string[], source: ParsedSolution, target: ParsedSolution, cmp: Comparison, others: ParsedSolution[] = []): SelectionReport {
  const edges = resolveReferences(source, [target, ...others], { sameNameCounts: true }); // target is usually another version/environment of the same solution
  const start = new Set(selected);
  // Selecting a table implies its tick of columns/forms is separate; start from the selected keys plus the children of selected parents.
  for (const r of cmp.rows) if (r.parent && start.has(r.parent)) start.add(r.id);
  const { found, truncated } = requirements([...start], edges);
  const needed: CompareRow[] = [];
  const missingMap = new Map<string, { ref: ResolvedRef["ref"]; dependents: Set<string> }>();
  let inTarget = 0, unverifiable = 0;
  for (const f of found) {
    if (start.has(f.key)) continue;
    const row = cmp.byId.get(f.key);
    if (f.status === "missing") {
      const g = missingMap.get(f.key) ?? { ref: f.ref, dependents: new Set<string>() };
      g.dependents.add(f.ref.from.name || f.ref.from.key);
      missingMap.set(f.key, g);
    } else if (row && (row.status === "new" || row.status === "different")) needed.push(row);
    else if (f.status === "unverifiable") unverifiable++;
    else if (f.status === "other" || row?.status === "same" || row?.status === "deleted") inTarget++;
  }
  return { needed, missing: [...missingMap.values()].map((m) => ({ ref: m.ref, dependents: [...m.dependents] })), alreadyInTarget: inTarget, unverifiable, truncated };
}
