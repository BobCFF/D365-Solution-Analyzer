"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  activeFilterCount, applyColumnFilters, defaultLayout, distinctValues, isFilterActive, matchesSearch, moveColumn, normalizeLayout, normalizeTableState, clampWidth,
  sortRows, toggleSetValue, type ColDef, type ColumnFilters, type ColumnLayout, type SortState, type TableState,
} from "@/lib/d365/columnFilter";
import { useSavedState } from "./uiState";
import { downloadCsv, MenuButton } from "./ui";

export interface TableColumn<T> extends ColDef<T> {
  /** custom cell; falls back to get() */
  render?: (row: T) => ReactNode;
  className?: string;
}

const MAX_ROWS = 2000;

/**
 * State + behaviour shared by every table: filters, sort, quick search, column layout (order/visibility), and the open
 * header menu. All of it is remembered per user (see uiState) under `table:<id>`.
 */
export function useColumnTable<T>(id: string, columns: TableColumn<T>[], opts: { initialFilters?: ColumnFilters; initialSort?: SortState | null } = {}) {
  const fallback: TableState = { filters: opts.initialFilters ?? {}, sort: opts.initialSort ?? null, layout: null, search: "", widths: {} };
  const [state, setState] = useSavedState<TableState>(`table:${id}`, fallback, (raw) => normalizeTableState(raw, columns, fallback));
  const layout: ColumnLayout = useMemo(() => normalizeLayout(state.layout ?? defaultLayout(columns), columns), [state.layout, columns]);
  const hidden = useMemo(() => new Set(layout.hidden), [layout.hidden]);
  const byKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);
  const visible = layout.order.map((k) => byKey.get(k)).filter((c): c is TableColumn<T> => !!c && !hidden.has(c.key));

  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const api = {
    id, columns, byKey, visible, layout, hidden, menu, opener,
    filters: state.filters, sort: state.sort, search: state.search,
    setFilters: (f: ColumnFilters | ((p: ColumnFilters) => ColumnFilters)) => setState((s) => ({ ...s, filters: typeof f === "function" ? f(s.filters) : f })),
    setSort: (v: SortState | null | ((p: SortState | null) => SortState | null)) => setState((s) => ({ ...s, sort: typeof v === "function" ? v(s.sort) : v })),
    setSearch: (search: string) => setState((s) => ({ ...s, search })),
    widths: state.widths,
    sized: Object.keys(state.widths).some((k) => visible.some((c) => c.key === k)),
    setWidths: (w: Record<string, number>) => setState((s) => ({ ...s, widths: w })),
    resetWidths: () => setState((s) => ({ ...s, widths: {} })),
    /** table style once any column has been resized: fixed layout, exact total width (extra = fixed non-data columns) */
    tableStyle: (extra = 0): CSSProperties | undefined => Object.keys(state.widths).some((k) => visible.some((c) => c.key === k))
      ? { width: visible.reduce((n, c) => n + (state.widths[c.key] ?? 160), extra) } : undefined,
    saveLayout: (l: ColumnLayout) => setState((s) => ({ ...s, layout: l })),
    toggleCol: (key: string) => setState((s) => { const l = normalizeLayout(s.layout ?? defaultLayout(columns), columns); const h = new Set(l.hidden); if (h.has(key)) h.delete(key); else h.add(key); return { ...s, layout: { order: l.order, hidden: [...h] } }; }),
    closeMenu: (restoreFocus = true) => { setMenu(null); if (restoreFocus) opener.current?.focus(); },
    openMenu: (key: string, el: HTMLElement) => {
      if (menu?.key === key) { setMenu(null); opener.current?.focus(); return; }
      opener.current = el;
      const r = el.getBoundingClientRect();
      const width = Math.min(300, window.innerWidth - 16);
      setMenu({ key, x: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), y: r.bottom + 4 });
    },
    /** search + column filters (no sort), for callers that sort or nest rows themselves */
    filter: (rows: T[]) => applyColumnFilters(rows.filter((r) => matchesSearch(r, columns, state.search)), columns, state.filters),
    process: (rows: T[]) => sortRows(applyColumnFilters(rows.filter((r) => matchesSearch(r, columns, state.search)), columns, state.filters), byKey.get(state.sort?.key ?? ""), state.sort?.dir ?? 1),
    clearAll: () => setState((s) => ({ ...s, filters: {}, search: "" })),
    nFilters: activeFilterCount(state.filters) + (state.search.trim() ? 1 : 0),
  };
  return api;
}
export type ColumnTableApi<T> = ReturnType<typeof useColumnTable<T>>;

/** Drag (or ←/→) to resize a column; double-click resets all widths. The first drag freezes the other columns at their current width. */
function ResizeHandle<T>({ api, col }: { api: ColumnTableApi<T>; col: TableColumn<T> }) {
  const base = (th: HTMLElement) => {
    const out: Record<string, number> = { ...api.widths };
    th.closest("tr")?.querySelectorAll<HTMLElement>("th[data-col]").forEach((h) => { const k = h.dataset.col!; if (out[k] === undefined) out[k] = clampWidth(h.offsetWidth); });
    return out;
  };
  const down = (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault(); e.stopPropagation();
    const th = e.currentTarget.closest("th")!; const start = base(th); const x0 = e.clientX;
    const move = (ev: PointerEvent) => api.setWidths({ ...start, [col.key]: clampWidth(start[col.key] + ev.clientX - x0) });
    const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up); };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
  };
  const key = (e: React.KeyboardEvent<HTMLElement>) => {
    const d = e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
    if (!d) return;
    e.preventDefault(); const w = base(e.currentTarget.closest("th")!); api.setWidths({ ...w, [col.key]: clampWidth(w[col.key] + d) });
  };
  return <span className="colresize" role="separator" aria-orientation="vertical" tabIndex={0} aria-label={`Resize ${col.label} column (arrow keys; double-click resets widths)`}
    onPointerDown={down} onKeyDown={key} onDoubleClick={api.resetWidths} />;
}

/** A header cell: sort button + ⋯ column menu trigger. */
export function ColumnHeader<T>({ api, col }: { api: ColumnTableApi<T>; col: TableColumn<T> }) {
  const on = isFilterActive(api.filters[col.key]);
  const sorted = api.sort?.key === col.key ? api.sort.dir : 0;
  return (
    <th data-col={col.key} style={api.sized ? { width: api.widths[col.key] ?? 160 } : undefined} aria-sort={sorted === 1 ? "ascending" : sorted === -1 ? "descending" : "none"}>
      <div className="thwrap">
        <button className="thbtn" onClick={() => api.setSort((s) => (s?.key === col.key ? (s.dir === 1 ? { key: col.key, dir: -1 } : null) : { key: col.key, dir: 1 }))}>{col.label}{sorted === 1 ? " ▲" : sorted === -1 ? " ▼" : ""}</button>
        <button className={`thmenu${on ? " on" : ""}`} aria-haspopup="menu" aria-expanded={api.menu?.key === col.key}
          aria-label={`${col.label} column options${on ? " (filtered)" : ""}`} onClick={(e) => api.openMenu(col.key, e.currentTarget)}>⋯</button>
      </div>
      <ResizeHandle api={api} col={col} />
    </th>
  );
}

/** The open column menu (sort, filter, move, hide). Render once per table, after the table. `rows` supplies the distinct values. */
export function ColumnMenuLayer<T>({ api, rows }: { api: ColumnTableApi<T>; rows: T[] }) {
  const { menu } = api;
  const ref = useRef<HTMLDivElement>(null);
  const [valueSearch, setValueSearch] = useState("");
  const col = menu ? api.byKey.get(menu.key) : undefined;

  // close on outside pointer, Esc and resize (not scroll: scrolling the value list, or the browser scrolling a focused input into view, must not close it)
  useEffect(() => {
    if (!menu) return;
    const out = (e: Event) => { const t = e.target as Node; if (!ref.current?.contains(t) && !api.opener.current?.contains(t)) api.closeMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") api.closeMenu(true); };
    const away = () => api.closeMenu(false);
    document.addEventListener("pointerdown", out); document.addEventListener("keydown", esc); window.addEventListener("resize", away);
    ref.current?.querySelector<HTMLElement>("button:not(:disabled), input")?.focus();
    return () => { document.removeEventListener("pointerdown", out); document.removeEventListener("keydown", esc); window.removeEventListener("resize", away); };
  }, [menu?.key]); // eslint-disable-line react-hooks/exhaustive-deps -- re-run only when a different menu opens

  // keep the whole menu on screen: shift it up when it would run past the bottom edge (headers can sit near the fold on phones)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!menu || !el) return;
    const r = el.getBoundingClientRect();
    if (r.bottom > window.innerHeight - 8) el.style.top = `${Math.max(8, window.innerHeight - r.height - 8)}px`;
  }, [menu, valueSearch]);

  const values = useMemo(() => (col?.filter === "set" ? distinctValues(rows, col) : []), [col, rows]);
  if (!menu || !col) return null;
  const vIndex = api.visible.findIndex((c) => c.key === col.key);
  const f = api.filters[col.key];
  const setFilter = (v: string | string[] | undefined) => api.setFilters((cur) => { const o = { ...cur }; if (v === undefined) delete o[col.key]; else o[col.key] = v; return o; });

  return (
    <div ref={ref} className="colmenu" role="dialog" aria-label={`${col.label} column options`} style={{ left: menu.x, top: menu.y } as CSSProperties}>
      <div className="colmenu-title">{col.label}</div>
      <div className="colmenu-actions">
        <button className="btn ghost sm" onClick={() => { api.setSort({ key: col.key, dir: 1 }); api.closeMenu(); }}>Sort A → Z</button>
        <button className="btn ghost sm" onClick={() => { api.setSort({ key: col.key, dir: -1 }); api.closeMenu(); }}>Sort Z → A</button>
        {api.sort?.key === col.key && <button className="btn ghost sm" onClick={() => { api.setSort(null); api.closeMenu(); }}>Clear sort</button>}
      </div>
      <hr />
      <div className="colmenu-title">Filter</div>
      {col.filter === "text" ? (
        <input type="search" aria-label={`Filter ${col.label} contains`} placeholder="Contains…" value={typeof f === "string" ? f : ""} onChange={(e) => setFilter(e.target.value)} />
      ) : (<>
        {values.length > 8 && <input type="search" aria-label="Search values" placeholder="Search values…" value={valueSearch} onChange={(e) => setValueSearch(e.target.value)} />}
        <div className="row" style={{ margin: "6px 0" }}>
          <button className="btn ghost sm" onClick={() => setFilter(undefined)}>Select all</button>
          <button className="btn ghost sm" onClick={() => setFilter([])}>Select none</button>
        </div>
        <ul className="colmenu-values">{values.filter(([v]) => v.toLowerCase().includes(valueSearch.toLowerCase())).map(([v, n]) => {
          const on = f === undefined || f === "" ? true : Array.isArray(f) ? f.includes(v) : f === v;
          return (<li key={v}><label className="row"><input type="checkbox" checked={on} onChange={() => setFilter(toggleSetValue(f, v, values.map(([x]) => x)))} /> <span>{v}</span> <span className="pill">{n}</span></label></li>);
        })}</ul>
      </>)}
      {isFilterActive(f) && <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => setFilter(undefined)}>Clear filter</button>}
      <hr />
      <div className="colmenu-actions">
        <button className="btn ghost sm" disabled={vIndex <= 0} onClick={() => api.saveLayout(moveColumn(api.layout, col.key, -1))}>← Move left</button>
        <button className="btn ghost sm" disabled={vIndex < 0 || vIndex >= api.visible.length - 1} onClick={() => api.saveLayout(moveColumn(api.layout, col.key, 1))}>Move right →</button>
        <button className="btn ghost sm" disabled={api.visible.length === 1} onClick={() => { api.toggleCol(col.key); api.closeMenu(false); }}>Hide column</button>
      </div>
    </div>
  );
}

/** Toolbar: count, quick search, Clear filters, Columns list (which columns to include), CSV export. */
export function TableToolbar<T>({ api, total, shown, onExport, extra }: { api: ColumnTableApi<T>; total: number; shown: number; onExport?: () => void; extra?: ReactNode }) {
  const { layout, hidden, byKey, visible, columns } = api;
  return (
    <div className="toolbar">
      <input type="search" aria-label="Search this table" placeholder="Search…" value={api.search} onChange={(e) => api.setSearch(e.target.value)} />
      <span className="muted" role="status">{shown} of {total} row(s){api.nFilters ? ` · ${api.nFilters} filter(s)` : ""}</span>
      <span className="grow" />
      {extra}
      {api.nFilters > 0 && <button className="btn ghost sm" onClick={api.clearAll}>Clear filters</button>}
      <MenuButton small ariaLabel="Choose columns" label={<>Columns ({visible.length}/{columns.length})</>}>
        <div className="multi-pop" role="group" aria-label="Columns to include">
          <p className="faint" style={{ margin: "0 0 6px" }}>Tick the columns to include. Use ⋯ on a header to move or hide one.</p>
          <div className="row"><button className="btn ghost sm" onClick={() => api.saveLayout({ order: layout.order, hidden: [] })}>Show all</button><button className="btn ghost sm" onClick={() => { api.saveLayout(defaultLayout(columns)); api.resetWidths(); }}>Reset</button></div>
          <ul>{layout.order.map((k) => byKey.get(k)).filter((c): c is TableColumn<T> => !!c).map((c) => (
            <li key={c.key}><label className="row"><input type="checkbox" checked={!hidden.has(c.key)} disabled={!hidden.has(c.key) && visible.length === 1} onChange={() => api.toggleCol(c.key)} /> {c.label}</label></li>
          ))}</ul>
        </div>
      </MenuButton>
      {onExport && <button className="btn ghost sm" disabled={!shown} onClick={onExport}>Export CSV</button>}
    </div>
  );
}

/**
 * Flat table with a ⋯ menu on every column header, a Columns list, quick search and CSV export. Filters, sort, search and
 * the column layout are remembered per user.
 */
export function ColumnTable<T>({ id, rows, columns, rowKey, exportName, rowClass, empty, initialFilters, initialSort, onRowClick, rowActions, actionsLabel }: {
  id: string; rows: T[]; columns: TableColumn<T>[]; rowKey: (r: T) => string; exportName: string; rowClass?: (r: T) => string; empty?: ReactNode;
  initialFilters?: ColumnFilters; initialSort?: SortState | null; onRowClick?: (r: T) => void; rowActions?: (r: T) => ReactNode; actionsLabel?: string;
}) {
  const api = useColumnTable(id, columns, { initialFilters, initialSort });
  const shown = useMemo(() => api.process(rows), [rows, api.filters, api.sort, api.search, api.layout]); // eslint-disable-line react-hooks/exhaustive-deps -- process closes over these
  const capped = shown.slice(0, MAX_ROWS);
  const colSpan = api.visible.length + (rowActions ? 1 : 0);

  return (<div>
    <TableToolbar api={api} total={rows.length} shown={shown.length} onExport={() => downloadCsv(exportName, [api.visible.map((c) => c.label), ...shown.map((r) => api.visible.map((c) => c.get(r)))])} />
    <div className="tablewrap"><table className={`coltable${api.sized ? " sized" : ""}`} style={api.tableStyle(rowActions ? 110 : 0)}>
      <thead><tr>{api.visible.map((c) => <ColumnHeader key={c.key} api={api} col={c} />)}{rowActions && <th style={api.sized ? { width: 110 } : undefined}>{actionsLabel ?? ""}</th>}</tr></thead>
      <tbody>
        {capped.map((r) => (
          <tr key={rowKey(r)} className={`${rowClass?.(r) ?? ""}${onRowClick ? " clickable" : ""}`} onClick={onRowClick ? () => onRowClick(r) : undefined}>
            {api.visible.map((c) => <td key={c.key} className={c.className}>{c.render ? c.render(r) : c.get(r)}</td>)}
            {rowActions && <td onClick={(e) => e.stopPropagation()}>{rowActions(r)}</td>}
          </tr>
        ))}
        {!capped.length && <tr><td colSpan={colSpan} className="muted">{rows.length ? "No rows match the filters." : empty ?? "Nothing to show."}</td></tr>}
      </tbody>
    </table></div>
    {shown.length > MAX_ROWS && <p className="muted">Showing the first {MAX_ROWS.toLocaleString()} of {shown.length.toLocaleString()} rows; narrow the filters or export CSV for all.</p>}
    <ColumnMenuLayer api={api} rows={rows} />
  </div>);
}
