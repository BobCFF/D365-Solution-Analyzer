import { webResourceName } from "./navigation";
import { CT_CONNECTION_REFERENCE, type ParsedSolution, type Reference } from "./types";
import { compareVersions, parseVersion } from "./version";

/** Stable identity of a component across solutions. */
export const ck = (type: number, key: string) => `${type}:${key.toLowerCase()}`;
const STANDARD_WEB_PREFIXES = /^(msdyn|msdynce|mscrm|mspp|adx|msft|ms|cc_MscrmControls|appmodule|_)/i;

/** Every dependency edge we can derive from a parsed solution (stored XML refs + nav/apps/flows/schema). */
export function collectReferences(sol: ParsedSolution): Reference[] {
  const refs: Reference[] = [...(sol.references ?? [])];
  const push = (r: Reference) => refs.push(r);

  for (const e of sol.entities ?? []) {
    for (const a of e.attributes) {
      push({ from: { type: 2, key: `${e.logical}.${a.name}` }, kind: "column-table", to: { type: 1, key: e.logical } });
      for (const t of a.targets ?? []) push({ from: { type: 2, key: `${e.logical}.${a.name}`, name: a.display }, kind: "lookup-target", to: { type: 1, key: t } });
    }
  }
  for (const sm of sol.siteMaps ?? []) {
    const rootKey = sm.id || sm.name;
    for (const area of sm.areas) {
      const areaFrom = { type: 62, key: `${rootKey}/${area.id}`, name: area.title };
      if (area.icon?.toLowerCase().startsWith("$webresource:")) push({ from: areaFrom, kind: "nav-icon", to: { type: 61, key: webResourceName(area.icon) }, detail: area.title });
      for (const g of area.groups) for (const s of g.subAreas) {
        const where = `${area.title} › ${g.title} › ${s.title}`;
        const from = { type: 62, key: `${rootKey}/${area.id}/${g.id}/${s.id}`, name: where };
        if (s.entity) push({ from, kind: "nav-table", to: { type: 1, key: s.entity }, detail: where });
        if (s.url && /^\$webresource:|^\/WebResources\//i.test(s.url)) push({ from, kind: "nav-webresource", to: { type: 61, key: webResourceName(s.url) }, detail: where });
        if (s.icon && /^\$webresource:/i.test(s.icon)) push({ from, kind: "nav-icon", to: { type: 61, key: webResourceName(s.icon) }, detail: where });
        if (s.dashboard) push({ from, kind: "nav-dashboard", to: { type: 60, key: s.dashboard }, detail: where });
        for (const p of s.privileges) push({ from, kind: "nav-privilege", to: { type: 1, key: p.entity }, detail: where });
      }
    }
  }
  for (const app of sol.apps ?? []) {
    const from = { type: 80, key: app.uniqueName, name: app.name };
    for (const c of app.components) push({ from, kind: "app-component", to: { type: c.type, key: c.key } });
    for (const r of app.roles) push({ from, kind: "app-role", to: { type: 20, key: r } });
  }
  for (const f of sol.flows ?? []) {
    const from = { type: 29, key: f.id, name: f.name };
    for (const c of f.connectionRefs) push({ from, kind: "flow-connref", to: { type: CT_CONNECTION_REFERENCE, key: c } });
    for (const v of f.envVars) push({ from, kind: "flow-envvar", to: { type: 380, key: v } });
    for (const c of f.childFlows) push({ from, kind: "flow-child", to: { type: 29, key: c } });
  }
  for (const r of sol.roles ?? []) {
    for (const t of Object.keys(r.privileges)) push({ from: { type: 20, key: r.id || r.name, name: r.name }, kind: "role-table", to: { type: 1, key: t } });
  }
  return refs;
}

/** Keys of everything this solution defines (so references to them are satisfied). */
export function providedKeys(sol: ParsedSolution): Set<string> {
  const s = new Set<string>();
  for (const rc of sol.rootComponents) s.add(ck(rc.type, rc.key));
  for (const i of sol.inventory) s.add(ck(i.type, i.key));
  for (const e of sol.entities ?? []) {
    s.add(ck(1, e.logical));
    for (const a of e.attributes) s.add(ck(2, `${e.logical}.${a.name}`));
  }
  for (const f of sol.flows ?? []) s.add(ck(29, f.id));
  for (const a of sol.apps ?? []) s.add(ck(80, a.uniqueName));
  return s;
}

export type DepStatus = "internal" | "other" | "platform" | "unverifiable" | "missing";
export interface ResolvedRef {
  ref: Reference;
  status: DepStatus;
  /** solution that satisfies it, when status is "other" */
  providedBy?: string;
}

const isCustom = (name: string) => name.includes("_");

/**
 * Classify each reference. Principle: only flag "missing" when we are confident - i.e. the target is a custom
 * component (has a publisher prefix / is a web resource / flow / app) that nothing loaded provides. Platform
 * components (no prefix) are assumed to exist; GUID-only views/forms/roles are "unverifiable" (may be system ones).
 */
export function resolveReferences(sol: ParsedSolution, others: ParsedSolution[] = [], opts: { sameNameCounts?: boolean } = {}): ResolvedRef[] {
  const mine = providedKeys(sol);
  const theirs = others.filter((o) => o !== sol && (opts.sameNameCounts || o.uniqueName !== sol.uniqueName)).map((o) => ({ name: o.uniqueName, keys: providedKeys(o), o }));
  const attrsOf = new Map((sol.entities ?? []).map((e) => [e.logical, e]));
  const isShell = (t: string) => {
    const e = attrsOf.get(t);
    return !e || e.attributes.length === 0 || sol.rootComponents.some((r) => r.type === 1 && r.key.toLowerCase() === t && r.behavior === 2);
  };
  const seen = new Set<string>();
  const out: ResolvedRef[] = [];
  for (const ref of collectReferences(sol)) {
    const dedupe = `${ref.from.type}:${ref.from.key}|${ref.kind}|${ref.to.type}:${ref.to.key}|${ref.detail ?? ""}`.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const key = ck(ref.to.type, ref.to.key);
    if (key === ck(ref.from.type, ref.from.key)) continue;
    if (mine.has(key)) { out.push({ ref, status: "internal" }); continue; }
    const hit = theirs.find((t) => t.keys.has(key));
    if (hit) { out.push({ ref, status: "other", providedBy: hit.name }); continue; }

    let status: DepStatus;
    const k = ref.to.key.toLowerCase();
    switch (ref.to.type) {
      case 1: status = isCustom(k) ? "missing" : "platform"; break;
      case 2: {
        const [table, col] = k.split(".");
        if (!isCustom(col ?? "")) status = "platform";
        else if (!isShell(table)) status = "missing";
        else status = "unverifiable";
        break;
      }
      case 61: status = STANDARD_WEB_PREFIXES.test(k) || !k ? "platform" : "missing"; break;
      case 29: case 80: case 380: case CT_CONNECTION_REFERENCE: status = "missing"; break;
      default: status = "unverifiable"; // GUID-addressed views, forms, dashboards, charts, roles, site maps
    }
    out.push({ ref, status });
  }
  return out;
}

/** Transitive requirements of a set of components (BFS over reference edges), like Salesforce Analyzer's requirements(). */
export function requirements(start: string[], edges: ResolvedRef[], maxDepth = 6): { found: { key: string; via: string; depth: number; status: DepStatus; ref: Reference }[]; truncated: boolean } {
  const byFrom = new Map<string, ResolvedRef[]>();
  for (const e of edges) { const k = ck(e.ref.from.type, e.ref.from.key); (byFrom.get(k) ?? byFrom.set(k, []).get(k)!).push(e); }
  const seen = new Set(start);
  const found: { key: string; via: string; depth: number; status: DepStatus; ref: Reference }[] = [];
  let frontier = start;
  let truncated = false;
  for (let depth = 1; frontier.length && depth <= maxDepth; depth++) {
    const next: string[] = [];
    for (const f of frontier) {
      for (const e of byFrom.get(f) ?? []) {
        const k = ck(e.ref.to.type, e.ref.to.key);
        if (seen.has(k)) continue;
        seen.add(k);
        found.push({ key: k, via: f, depth, status: e.status, ref: e.ref });
        next.push(k);
      }
    }
    frontier = next;
    if (depth === maxDepth && next.length) truncated = true;
  }
  return { found, truncated };
}

export interface ImportPlan {
  order: { solution: string; version: string; after: string[] }[];
  cycles: string[][];
}

/** Order loaded solutions so dependencies import first (patches after their parent). Kahn's algorithm. */
export function planImportOrder(sols: ParsedSolution[]): ImportPlan {
  const latest = new Map<string, ParsedSolution>();
  for (const s of sols) {
    const cur = latest.get(s.uniqueName);
    const a = parseVersion(s.version), b = cur && parseVersion(cur.version);
    if (!cur || (a && b && compareVersions(a, b) > 0)) latest.set(s.uniqueName, s);
  }
  const list = [...latest.values()];
  const deps = new Map<string, Set<string>>(list.map((s) => [s.uniqueName, new Set<string>()]));
  for (const s of list) {
    if (s.parentSolutionName && deps.has(s.parentSolutionName)) deps.get(s.uniqueName)!.add(s.parentSolutionName);
    for (const r of resolveReferences(s, list)) if (r.status === "other" && r.providedBy && r.providedBy !== s.uniqueName) deps.get(s.uniqueName)!.add(r.providedBy);
    for (const m of s.missingDependencies) if (m.requiredSolution && deps.has(m.requiredSolution)) deps.get(s.uniqueName)!.add(m.requiredSolution);
  }
  const order: ImportPlan["order"] = [];
  const done = new Set<string>();
  let remaining = list.map((s) => s.uniqueName).sort();
  while (remaining.length) {
    const ready = remaining.filter((n) => [...deps.get(n)!].every((d) => done.has(d)));
    if (!ready.length) break;
    for (const n of ready) { order.push({ solution: n, version: latest.get(n)!.version, after: [...deps.get(n)!].sort() }); done.add(n); }
    remaining = remaining.filter((n) => !done.has(n));
  }
  return { order, cycles: remaining.length ? [remaining] : [] };
}
