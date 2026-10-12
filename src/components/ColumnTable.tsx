"use client";

import { useMemo, useState, type ReactNode } from "react";
import { activeFilterCount, applyColumnFilters, distinctValues, sortRows, type ColDef, type ColumnFilters } from "@/lib/d365/columnFilter";
import { downloadCsv, MenuButton } from "./ui";

export interface TableColumn<T> extends ColDef<T> {
  /** custom cell; falls back to get() */
  render?: (row: T) => ReactNode;
  className?: string;
}

const storageKey = (id: string) => `d365-sa-cols-${id}`;
function loadHidden(id: string, cols: { key: string; defaultVisible?: boolean }[]): Set<string> {
  try { const raw = localStorage.getItem(storageKey(id)); if (raw) return new Set(JSON.parse(raw) as string[]); } catch { /* storage unavailable or corrupt */ }
  return new Set(cols.filter((c) => c.defaultVisible === false).map((c) => c.key));
}

/**
 * Table with a filter under every column header (dropdown for set columns, text box for text columns), sortable
 * headers, a Columns menu to show/hide columns (remembered per table), and CSV export of what you see.
 */
export function ColumnTable<T>({ id, rows, columns, rowKey, exportName, rowClass, empty }: {
  id: string; rows: T[]; columns: TableColumn<T>[]; rowKey: (r: T) => string; exportName: string; rowClass?: (r: T) => string; empty?: ReactNode;
}) {
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => loadHidden(id, columns));
  const visible = columns.filter((c) => !hidden.has(c.key));

  const filtered = useMemo(() => applyColumnFilters(rows, columns, filters), [rows, columns, filters]);
  const shown = useMemo(() => sortRows(filtered, columns.find((c) => c.key === sort?.key), sort?.dir ?? 1), [filtered, columns, sort]);
  const nFilters = activeFilterCount(filters);

  const toggleCol = (key: string) => setHidden((h) => {
    const n = new Set(h); if (n.has(key)) n.delete(key); else n.add(key);
    try { localStorage.setItem(storageKey(id), JSON.stringify([...n])); } catch { /* storage unavailable */ }
    return n;
  });
  const onSort = (key: string) => setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));

  return (<div>
    <div className="toolbar">
      <span className="muted" role="status">{shown.length} of {rows.length} row(s){nFilters ? ` · ${nFilters} column filter(s)` : ""}</span>
      <span className="grow" />
      {nFilters > 0 && <button className="btn ghost sm" onClick={() => setFilters({})}>Clear column filters</button>}
      <MenuButton small ariaLabel="Choose columns" label={<>Columns ({visible.length}/{columns.length})</>}>
        <div className="multi-pop" role="group" aria-label="Visible columns">
          <ul>{columns.map((c) => <li key={c.key}><label className="row"><input type="checkbox" checked={!hidden.has(c.key)} disabled={!hidden.has(c.key) && visible.length === 1} onChange={() => toggleCol(c.key)} /> {c.label}</label></li>)}</ul>
        </div>
      </MenuButton>
      <button className="btn ghost sm" disabled={!shown.length} onClick={() => downloadCsv(exportName, [visible.map((c) => c.label), ...shown.map((r) => visible.map((c) => c.get(r)))])}>Export CSV</button>
    </div>
    <div className="tablewrap"><table className="coltable">
      <thead>
        <tr>{visible.map((c) => (
          <th key={c.key} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
            <button className="thbtn" onClick={() => onSort(c.key)}>{c.label}{sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</button>
          </th>))}
        </tr>
        <tr className="filterrow">{visible.map((c) => (
          <th key={c.key}>
            {c.filter === "set" ? (
              <select aria-label={`Filter ${c.label}`} value={filters[c.key] ?? ""} onChange={(e) => setFilters((f) => ({ ...f, [c.key]: e.target.value }))}>
                <option value="">All</option>
                {distinctValues(rows, c).map(([v, n]) => <option key={v} value={v}>{v} ({n})</option>)}
              </select>
            ) : (
              <input type="search" aria-label={`Filter ${c.label}`} placeholder="Filter…" value={filters[c.key] ?? ""} onChange={(e) => setFilters((f) => ({ ...f, [c.key]: e.target.value }))} />
            )}
          </th>))}
        </tr>
      </thead>
      <tbody>
        {shown.map((r) => <tr key={rowKey(r)} className={rowClass?.(r)}>{visible.map((c) => <td key={c.key} className={c.className}>{c.render ? c.render(r) : c.get(r)}</td>)}</tr>)}
        {!shown.length && <tr><td colSpan={visible.length} className="muted">{rows.length ? "No rows match the column filters." : empty ?? "Nothing to show."}</td></tr>}
      </tbody>
    </table></div>
  </div>);
}
