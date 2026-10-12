"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  activeFilterCount, applyColumnFilters, defaultLayout, distinctValues, isFilterActive, moveColumn, normalizeLayout, sortRows, toggleSetValue,
  type ColDef, type ColumnFilters, type ColumnLayout,
} from "@/lib/d365/columnFilter";
import { downloadCsv, MenuButton } from "./ui";

export interface TableColumn<T> extends ColDef<T> {
  /** custom cell; falls back to get() */
  render?: (row: T) => ReactNode;
  className?: string;
}

const storageKey = (id: string) => `d365-sa-cols-v2-${id}`;
function loadLayout(id: string, cols: { key: string; defaultVisible?: boolean }[]): ColumnLayout {
  try { const raw = localStorage.getItem(storageKey(id)); if (raw) return normalizeLayout(JSON.parse(raw) as Partial<ColumnLayout>, cols); } catch { /* storage unavailable or corrupt */ }
  return defaultLayout(cols);
}

/**
 * Table with a ⋯ menu on every column header (sort, filter, move left/right, hide), a Columns list to choose which
 * columns are included (and their order), and CSV export of what you see. Layout is remembered per table.
 */
export function ColumnTable<T>({ id, rows, columns, rowKey, exportName, rowClass, empty }: {
  id: string; rows: T[]; columns: TableColumn<T>[]; rowKey: (r: T) => string; exportName: string; rowClass?: (r: T) => string; empty?: ReactNode;
}) {
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [layout, setLayout] = useState<ColumnLayout>(() => loadLayout(id, columns));
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const [valueSearch, setValueSearch] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const byKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);
  const hidden = useMemo(() => new Set(layout.hidden), [layout.hidden]);
  const visible = layout.order.map((k) => byKey.get(k)).filter((c): c is TableColumn<T> => !!c && !hidden.has(c.key));

  const filtered = useMemo(() => applyColumnFilters(rows, columns, filters), [rows, columns, filters]);
  const shown = useMemo(() => sortRows(filtered, byKey.get(sort?.key ?? ""), sort?.dir ?? 1), [filtered, byKey, sort]);
  const nFilters = activeFilterCount(filters);

  const saveLayout = (next: ColumnLayout) => {
    setLayout(next);
    try { localStorage.setItem(storageKey(id), JSON.stringify(next)); } catch { /* storage unavailable */ }
  };
  const toggleCol = (key: string) => saveLayout({ order: layout.order, hidden: hidden.has(key) ? layout.hidden.filter((k) => k !== key) : [...layout.hidden, key] });
  const closeMenu = (restoreFocus = true) => { setMenu(null); setValueSearch(""); if (restoreFocus) opener.current?.focus(); };

  const openMenu = (key: string, el: HTMLElement) => {
    if (menu?.key === key) { closeMenu(); return; }
    opener.current = el;
    const r = el.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 16);
    setValueSearch("");
    setMenu({ key, x: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), y: r.bottom + 4 });
  };

  // close on outside pointer, Esc and resize (not on scroll: scrolling the value list or the browser scrolling a focused input into view must not close it); focus moves into the menu when it opens
  useEffect(() => {
    if (!menu) return;
    const out = (e: Event) => { const t = e.target as Node; if (!menuRef.current?.contains(t) && !opener.current?.contains(t)) setMenu(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(null); setValueSearch(""); opener.current?.focus(); } };
    const away = () => setMenu(null);
    document.addEventListener("pointerdown", out); document.addEventListener("keydown", esc);
    window.addEventListener("resize", away);
    menuRef.current?.querySelector<HTMLElement>("button:not(:disabled), input")?.focus();
    return () => { document.removeEventListener("pointerdown", out); document.removeEventListener("keydown", esc); window.removeEventListener("resize", away); };
  }, [menu?.key]); // eslint-disable-line react-hooks/exhaustive-deps -- re-run only when a different menu opens

  const col = menu ? byKey.get(menu.key) : undefined;
  const values = useMemo(() => (col?.filter === "set" ? distinctValues(rows, col) : []), [col, rows]);
  const vIndex = col ? visible.findIndex((c) => c.key === col.key) : -1;

  return (<div>
    <div className="toolbar">
      <span className="muted" role="status">{shown.length} of {rows.length} row(s){nFilters ? ` · ${nFilters} column filter(s)` : ""}</span>
      <span className="grow" />
      {nFilters > 0 && <button className="btn ghost sm" onClick={() => setFilters({})}>Clear column filters</button>}
      <MenuButton small ariaLabel="Choose columns" label={<>Columns ({visible.length}/{columns.length})</>}>
        <div className="multi-pop" role="group" aria-label="Columns to include">
          <p className="faint" style={{ margin: "0 0 6px" }}>Tick the columns to include. Use ⋯ on a header to move or hide one.</p>
          <div className="row"><button className="btn ghost sm" onClick={() => saveLayout({ order: layout.order, hidden: [] })}>Show all</button><button className="btn ghost sm" onClick={() => saveLayout(defaultLayout(columns))}>Reset</button></div>
          <ul>{layout.order.map((k) => byKey.get(k)).filter((c): c is TableColumn<T> => !!c).map((c) => (
            <li key={c.key}><label className="row"><input type="checkbox" checked={!hidden.has(c.key)} disabled={!hidden.has(c.key) && visible.length === 1} onChange={() => toggleCol(c.key)} /> {c.label}</label></li>
          ))}</ul>
        </div>
      </MenuButton>
      <button className="btn ghost sm" disabled={!shown.length} onClick={() => downloadCsv(exportName, [visible.map((c) => c.label), ...shown.map((r) => visible.map((c) => c.get(r)))])}>Export CSV</button>
    </div>

    <div className="tablewrap"><table className="coltable">
      <thead><tr>{visible.map((c) => {
        const filteredHere = isFilterActive(filters[c.key]);
        return (
          <th key={c.key} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
            <div className="thwrap">
              <button className="thbtn" onClick={() => setSort((s) => (s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }))}>{c.label}{sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</button>
              <button className={`thmenu${filteredHere ? " on" : ""}`} aria-haspopup="menu" aria-expanded={menu?.key === c.key}
                aria-label={`${c.label} column options${filteredHere ? " (filtered)" : ""}`} onClick={(e) => openMenu(c.key, e.currentTarget)}>⋯</button>
            </div>
          </th>);
      })}</tr></thead>
      <tbody>
        {shown.map((r) => <tr key={rowKey(r)} className={rowClass?.(r)}>{visible.map((c) => <td key={c.key} className={c.className}>{c.render ? c.render(r) : c.get(r)}</td>)}</tr>)}
        {!shown.length && <tr><td colSpan={visible.length} className="muted">{rows.length ? "No rows match the column filters." : empty ?? "Nothing to show."}</td></tr>}
      </tbody>
    </table></div>

    {menu && col && (
      <div ref={menuRef} className="colmenu" role="dialog" aria-label={`${col.label} column options`} style={{ left: menu.x, top: menu.y } as CSSProperties}>
        <div className="colmenu-title">{col.label}</div>
        <div className="colmenu-actions">
          <button className="btn ghost sm" onClick={() => { setSort({ key: col.key, dir: 1 }); closeMenu(); }}>Sort A → Z</button>
          <button className="btn ghost sm" onClick={() => { setSort({ key: col.key, dir: -1 }); closeMenu(); }}>Sort Z → A</button>
          {sort?.key === col.key && <button className="btn ghost sm" onClick={() => { setSort(null); closeMenu(); }}>Clear sort</button>}
        </div>
        <hr />
        <div className="colmenu-title">Filter</div>
        {col.filter === "text" ? (
          <input type="search" aria-label={`Filter ${col.label} contains`} placeholder="Contains…" value={typeof filters[col.key] === "string" ? (filters[col.key] as string) : ""}
            onChange={(e) => setFilters((f) => ({ ...f, [col.key]: e.target.value }))} />
        ) : (<>
          {values.length > 8 && <input type="search" aria-label="Search values" placeholder="Search values…" value={valueSearch} onChange={(e) => setValueSearch(e.target.value)} />}
          <div className="row" style={{ margin: "6px 0" }}>
            <button className="btn ghost sm" onClick={() => setFilters((f) => { const n = { ...f }; delete n[col.key]; return n; })}>Select all</button>
            <button className="btn ghost sm" onClick={() => setFilters((f) => ({ ...f, [col.key]: [] }))}>Select none</button>
          </div>
          <ul className="colmenu-values">{values.filter(([v]) => v.toLowerCase().includes(valueSearch.toLowerCase())).map(([v, n]) => {
            const f = filters[col.key];
            const on = f === undefined || f === "" ? true : Array.isArray(f) ? f.includes(v) : f === v;
            return (<li key={v}><label className="row"><input type="checkbox" checked={on} onChange={() => setFilters((cur) => {
              const next = toggleSetValue(cur[col.key], v, values.map(([x]) => x)); const o = { ...cur };
              if (next === undefined) delete o[col.key]; else o[col.key] = next; return o; })} /> <span>{v}</span> <span className="pill">{n}</span></label></li>);
          })}</ul>
        </>)}
        {isFilterActive(filters[col.key]) && <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => setFilters((f) => { const n = { ...f }; delete n[col.key]; return n; })}>Clear filter</button>}
        <hr />
        <div className="colmenu-actions">
          <button className="btn ghost sm" disabled={vIndex <= 0} onClick={() => saveLayout(moveColumn(layout, col.key, -1))}>← Move left</button>
          <button className="btn ghost sm" disabled={vIndex < 0 || vIndex >= visible.length - 1} onClick={() => saveLayout(moveColumn(layout, col.key, 1))}>Move right →</button>
          <button className="btn ghost sm" disabled={visible.length === 1} onClick={() => { toggleCol(col.key); closeMenu(false); }}>Hide column</button>
        </div>
      </div>
    )}
  </div>);
}
