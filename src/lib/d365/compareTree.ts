import { STATUS_ORDER, type CompareRow, type Comparison, type DiffStatus } from "./comparison";

export type Tab = "all" | DiffStatus;
export interface TreeRow { row: CompareRow; depth: number; hasChildren: boolean; expanded: boolean }
export interface TreeOptions {
  tab: Tab; type: number | null; q: string; expanded: Set<string>;
  /** extra predicate (quick search + column filters) */
  pass?: (r: CompareRow) => boolean;
  /** explicit order (row id -> position), e.g. from a column sort; defaults to status, type, name */
  rank?: Map<string, number>;
}

const inTab = (r: CompareRow, tab: Tab) => tab === "all" || r.status === tab;

/** Parents (tables, site maps) with children nested; a parent is shown if it or any child matches (Salesforce Analyzer's buildRows). */
export function buildTree(cmp: Comparison, o: TreeOptions): TreeRow[] {
  const q = o.q.trim().toLowerCase();
  const match = (r: CompareRow) => inTab(r, o.tab) && (!q || `${r.name} ${r.key} ${r.typeName}`.toLowerCase().includes(q)) && (o.pass?.(r) ?? true);
  const children = new Map<string, CompareRow[]>();
  for (const r of cmp.rows) if (r.parent && cmp.byId.has(r.parent)) (children.get(r.parent) ?? children.set(r.parent, []).get(r.parent)!).push(r);
  const sort = (a: CompareRow, b: CompareRow) => (o.rank ? (o.rank.get(a.id) ?? 0) - (o.rank.get(b.id) ?? 0) : 0) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.typeName.localeCompare(b.typeName) || a.name.localeCompare(b.name);
  const out: TreeRow[] = [];
  const flat = o.type !== null; // a specific type selected -> flat list, no nesting
  if (flat) {
    for (const r of cmp.rows.filter((r) => r.type === o.type && match(r)).sort(sort)) out.push({ row: r, depth: 0, hasChildren: false, expanded: false });
    return out;
  }
  const forced = q !== "" || o.tab !== "all" || o.pass !== undefined;
  for (const r of cmp.rows.filter((r) => !r.parent || !cmp.byId.has(r.parent)).sort(sort)) {
    const kids = (children.get(r.id) ?? []).filter(match).sort(sort);
    if (!match(r) && !kids.length) continue;
    const open = forced || o.expanded.has(r.id);
    out.push({ row: r, depth: 0, hasChildren: (children.get(r.id) ?? []).length > 0, expanded: open });
    if (open) for (const k of kids) out.push({ row: k, depth: 1, hasChildren: false, expanded: false });
  }
  return out;
}

export function countByType(cmp: Comparison, tab: Tab, q: string, pass?: (r: CompareRow) => boolean): Map<number, number> {
  const m = new Map<number, number>();
  const needle = q.trim().toLowerCase();
  for (const r of cmp.rows) {
    if (tab !== "all" && r.status !== tab) continue;
    if (needle && !`${r.name} ${r.key}`.toLowerCase().includes(needle)) continue;
    if (pass && !pass(r)) continue;
    m.set(r.type, (m.get(r.type) ?? 0) + 1);
  }
  return m;
}
