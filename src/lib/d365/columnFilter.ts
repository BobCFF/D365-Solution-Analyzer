/** Pure logic for tables with per-column filters (Excel-style): text columns filter by "contains", set columns by exact value. */
export interface ColDef<T> {
  key: string;
  label: string;
  get: (row: T) => string;
  /** "text": contains; "set": pick one of the distinct values */
  filter: "text" | "set";
  defaultVisible?: boolean;
  /** optional numeric/ordinal sort key (otherwise a case-insensitive string compare of get()) */
  sortValue?: (row: T) => number | string;
}
export type ColumnFilters = Record<string, string>;

export function applyColumnFilters<T>(rows: T[], cols: ColDef<T>[], filters: ColumnFilters): T[] {
  const active = cols.filter((c) => (filters[c.key] ?? "") !== "");
  if (!active.length) return rows;
  return rows.filter((r) => active.every((c) => {
    const v = c.get(r), f = filters[c.key];
    return c.filter === "set" ? v === f : v.toLowerCase().includes(f.toLowerCase());
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

export const activeFilterCount = (filters: ColumnFilters) => Object.values(filters).filter((v) => v !== "").length;
