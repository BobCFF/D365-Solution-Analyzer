/**
 * Pure logic for tables with per-column menus (Excel/Salesforce-Analyzer style): filters, sort, and a persisted
 * column layout (order + hidden columns) that heals itself when columns are added or removed in a later version.
 */
export interface ColDef<T> {
  key: string;
  label: string;
  get: (row: T) => string;
  /** "text": contains; "set": pick which of the distinct values to include */
  filter: "text" | "set";
  defaultVisible?: boolean;
  /** optional numeric/ordinal sort key (otherwise a case-insensitive string compare of get()) */
  sortValue?: (row: T) => number | string;
}

/** text columns: a "contains" string; set columns: the values to INCLUDE (an empty array shows nothing); a plain string on a set column means exactly that value. */
export type ColumnFilter = string | string[];
export type ColumnFilters = Record<string, ColumnFilter>;

export function isFilterActive(f: ColumnFilter | undefined): boolean {
  return Array.isArray(f) ? true : (f ?? "") !== "";
}

export function applyColumnFilters<T>(rows: T[], cols: ColDef<T>[], filters: ColumnFilters): T[] {
  const active = cols.filter((c) => isFilterActive(filters[c.key]));
  if (!active.length) return rows;
  return rows.filter((r) => active.every((c) => {
    const v = c.get(r), f = filters[c.key];
    if (c.filter === "set") return Array.isArray(f) ? f.includes(v) : v === f;
    const needle = (Array.isArray(f) ? f.join(" ") : f).toLowerCase();
    return v.toLowerCase().includes(needle);
  }));
}

/** Distinct values of a column over the given rows, with counts, most frequent first. */
export function distinctValues<T>(rows: T[], col: ColDef<T>): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) { const v = col.get(r); if (v !== "") m.set(v, (m.get(v) ?? 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function sortRows<T>(rows: T[], col: ColDef<T> | undefined, dir: 1 | -1): T[] {
  if (!col) return rows;
  const key = (r: T) => col.sortValue?.(r) ?? col.get(r).toLowerCase();
  return [...rows].sort((a, b) => {
    const x = key(a), y = key(b);
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
  });
}

export const activeFilterCount = (filters: ColumnFilters) => Object.values(filters).filter(isFilterActive).length;

/** Toggle one value of a set filter. No filter yet = everything included, so unchecking one value excludes just that one. */
export function toggleSetValue(current: ColumnFilter | undefined, value: string, all: string[]): ColumnFilters[string] | undefined {
  const included = Array.isArray(current) ? new Set(current) : typeof current === "string" && current !== "" ? new Set([current]) : new Set(all);
  if (included.has(value)) included.delete(value); else included.add(value);
  return all.every((v) => included.has(v)) ? undefined : all.filter((v) => included.has(v));
}

/* ---- column layout ---- */
export interface ColumnLayout { order: string[]; hidden: string[] }

/** Repair a saved layout against the current column set: drop unknown keys, append new columns (hidden if defaultVisible === false). */
export function normalizeLayout(saved: Partial<ColumnLayout> | null | undefined, cols: { key: string; defaultVisible?: boolean }[]): ColumnLayout {
  const keys = new Set(cols.map((c) => c.key));
  const order = (Array.isArray(saved?.order) ? saved!.order : []).filter((k): k is string => typeof k === "string" && keys.has(k));
  const seen = new Set(order);
  const hidden = new Set((Array.isArray(saved?.hidden) ? saved!.hidden : []).filter((k): k is string => typeof k === "string" && keys.has(k)));
  // columns the saved layout has never seen (first run, or added in a later version) start at their default visibility
  for (const c of cols) if (!seen.has(c.key)) { order.push(c.key); if (c.defaultVisible === false) hidden.add(c.key); }
  return { order, hidden: [...hidden] };
}

export function defaultLayout(cols: { key: string; defaultVisible?: boolean }[]): ColumnLayout {
  return { order: cols.map((c) => c.key), hidden: cols.filter((c) => c.defaultVisible === false).map((c) => c.key) };
}

/** Move a column among the VISIBLE columns by one step (hidden columns keep their relative place). */
export function moveColumn(layout: ColumnLayout, key: string, dir: -1 | 1): ColumnLayout {
  const hidden = new Set(layout.hidden);
  const visible = layout.order.filter((k) => !hidden.has(k));
  const i = visible.indexOf(key), j = i + dir;
  if (i < 0 || j < 0 || j >= visible.length) return layout;
  const target = visible[j];
  const order = layout.order.filter((k) => k !== key);
  const at = order.indexOf(target);
  order.splice(dir === 1 ? at + 1 : at, 0, key);
  return { order, hidden: layout.hidden };
}

/* ---- saved per-table state ---- */
export interface SortState { key: string; dir: 1 | -1 }
export interface TableState { filters: ColumnFilters; sort: SortState | null; layout: ColumnLayout | null; search: string; widths: Record<string, number> }

export const MIN_COL_WIDTH = 48;
export const MAX_COL_WIDTH = 1200;
export const clampWidth = (w: number) => Math.round(Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, w)));

/** Validate saved table state against the current columns (unknown columns, bad shapes and stale layouts are repaired or dropped). */
export function normalizeTableState(raw: unknown, cols: { key: string; defaultVisible?: boolean }[], fallback: TableState): TableState {
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Partial<Record<keyof TableState, unknown>>;
  const keys = new Set(cols.map((c) => c.key));
  const filters: ColumnFilters = {};
  if (r.filters && typeof r.filters === "object" && !Array.isArray(r.filters)) {
    for (const [k, v] of Object.entries(r.filters as Record<string, unknown>)) {
      if (!keys.has(k)) continue;
      if (typeof v === "string") filters[k] = v.slice(0, 500);
      else if (Array.isArray(v)) filters[k] = v.filter((x): x is string => typeof x === "string").slice(0, 500);
    }
  }
  const s = r.sort as Partial<SortState> | null | undefined;
  const sort = s && typeof s.key === "string" && keys.has(s.key) && (s.dir === 1 || s.dir === -1) ? { key: s.key, dir: s.dir } : null;
  const layout = r.layout && typeof r.layout === "object" ? normalizeLayout(r.layout as Partial<ColumnLayout>, cols) : null;
  const widths: Record<string, number> = {};
  if (r.widths && typeof r.widths === "object" && !Array.isArray(r.widths)) {
    for (const [k, v] of Object.entries(r.widths as Record<string, unknown>)) if (keys.has(k) && typeof v === "number" && Number.isFinite(v)) widths[k] = clampWidth(v);
  }
  return { filters, sort, layout, search: typeof r.search === "string" ? r.search.slice(0, 500) : "", widths };
}

/** Quick search: every column's text, case-insensitive. */
export function matchesSearch<T>(row: T, cols: ColDef<T>[], needle: string): boolean {
  const n = needle.trim().toLowerCase();
  return !n || cols.some((c) => c.get(row).toLowerCase().includes(n));
}
