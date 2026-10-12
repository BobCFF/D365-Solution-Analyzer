"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeSelection, compareSets, STATUS_LABEL, type CompareRow, type Comparison, type DiffStatus } from "@/lib/d365/comparison";
import { componentTypeName } from "@/lib/d365/componentTypes";
import { buildTree, countByType, type Tab } from "@/lib/d365/compareTree";
import { collectReferences, ck } from "@/lib/d365/dependencies";
import type { ParsedFlow, ParsedSolution } from "@/lib/d365/types";
import { FlowDiagram } from "./FlowDiagram";
import { sortRows } from "@/lib/d365/columnFilter";
import { asOneOf, asString } from "@/lib/uiStateStore";
import { useProgress } from "./progress";
import { ColumnHeader, ColumnMenuLayer, ColumnTable, TableToolbar, useColumnTable, type TableColumn } from "./ColumnTable";
import { useSavedState } from "./uiState";
import { downloadCsv } from "./ui";
import { SolutionPicker, type SolutionRow } from "./views";

type Pane = "summary" | "deps" | "flow";
const TABS: [Tab, string][] = [["all", "All items"], ["new", "New"], ["different", "Different"], ["deleted", "Deleted"], ["same", "Identical"]];

const COMPARE_COLUMNS: TableColumn<CompareRow>[] = [
  { key: "name", label: "Name", filter: "text", get: (r) => `${r.name} ${r.key}` },
  { key: "type", label: "Type", filter: "set", get: (r) => r.typeName },
  { key: "status", label: "Difference", filter: "set", get: (r) => STATUS_LABEL[r.status], sortValue: (r) => ({ different: 0, new: 1, deleted: 2, same: 3 })[r.status] },
  { key: "details", label: "Details", filter: "text", get: (r) => r.changes.join(" · ") },
];

interface ComparePrefs { src: string; tgt: string; tab: Tab; type: number }   // type -1 = all types
const normalizeCompare = (raw: unknown): ComparePrefs => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { src: asString(r.src), tgt: asString(r.tgt), tab: asOneOf(r.tab, ["all", "new", "different", "deleted", "same"] as const, "all"), type: typeof r.type === "number" ? r.type : -1 };
};

export function StatusDot({ s }: { s: DiffStatus }) {
  return <span className="dt"><span className={`di ${s}`} aria-hidden="true">{s === "new" ? "+" : s === "deleted" ? "−" : ""}</span>{STATUS_LABEL[s]}</span>;
}

/**
 * Source -> target comparison laid out like Salesforce Analyzer's compare page: type sidebar, status tabs, selectable
 * tree grid, and a bottom pane (Summary / Dependencies / Flow diagram). Ticking rows and "Tick dependencies" shows
 * what a deployment would still be missing.
 */
export function CompareApp({ solutions, load, onLogged }: {
  solutions: SolutionRow[]; load: (id: string) => Promise<ParsedSolution>; onLogged: (leftId: string, rightId: string) => void;
}) {
  // remembered per user: the two solutions, the status tab and the type; the table filters/sort/columns are saved by useColumnTable
  const [prefs, setPrefs] = useSavedState<ComparePrefs>("compare", { src: "", tgt: "", tab: "all", type: -1 }, normalizeCompare);
  const srcId = prefs.src, tgtId = prefs.tgt, tab = prefs.tab, type = prefs.type === -1 ? null : prefs.type;
  const setSrcId = (src: string) => setPrefs((p) => ({ ...p, src }));
  const setTgtId = (tgt: string) => setPrefs((p) => ({ ...p, tgt }));
  const setTab = (t: Tab) => setPrefs((p) => ({ ...p, tab: t }));
  const setType = (t: number | null) => setPrefs((p) => ({ ...p, type: t ?? -1 }));
  const tbl = useColumnTable<CompareRow>("compare", COMPARE_COLUMNS);
  const [pair, setPair] = useState<{ src: ParsedSolution; tgt: ParsedSolution } | null>(null);
  const progress = useProgress();
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("summary");
  const [notice, setNotice] = useState("");

  const run = () => progress.track("Comparing solutions", async (h) => {
    setBusy(true); setErr(""); setTicked(new Set()); setActive(null); setNotice("");
    try {
      h.set({ detail: "Loading the source and target solutions", pct: 20 });
      const [src, tgt] = await Promise.all([load(srcId), load(tgtId)]);
      h.set({ detail: "Comparing components and resolving dependencies", pct: 80 });
      setPair({ src, tgt }); onLogged(srcId, tgtId);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  });

  const cmp: Comparison | null = useMemo(() => (pair ? compareSets(pair.src, pair.tgt) : null), [pair]);
  // quick search + column filters become a predicate over rows; a column sort becomes an explicit order
  const pass = useMemo(() => {
    if (!cmp || tbl.nFilters === 0) return undefined;
    const ok = new Set(tbl.filter(cmp.rows).map((r) => r.id));
    return (r: CompareRow) => ok.has(r.id);
  }, [cmp, tbl.filters, tbl.search]); // eslint-disable-line react-hooks/exhaustive-deps -- tbl.filter closes over these
  const rank = useMemo(() => {
    if (!cmp || !tbl.sort) return undefined;
    return new Map(sortRows(cmp.rows, tbl.byKey.get(tbl.sort.key), tbl.sort.dir).map((r, i) => [r.id, i] as const));
  }, [cmp, tbl.sort, tbl.byKey]);
  const tree = useMemo(() => (cmp ? buildTree(cmp, { tab, type, q: "", expanded, pass, rank }) : []), [cmp, tab, type, expanded, pass, rank]);
  const typeCounts = useMemo(() => (cmp ? countByType(cmp, tab, "", pass) : new Map<number, number>()), [cmp, tab, pass]);

  // restore the last comparison when the page is reopened (once, if both solutions still exist)
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || pair || !srcId || !tgtId || srcId === tgtId) return;
    if (!solutions.some((x) => x.id === srcId) || !solutions.some((x) => x.id === tgtId)) return;
    restored.current = true;
    void Promise.resolve().then(() => run());   // deferred so state updates happen outside the effect body
  }); // no dependency array on purpose: re-checks whenever solutions arrive, and `restored` guards the single run
  const report = useMemo(() => (cmp && pair && ticked.size ? analyzeSelection([...ticked], pair.src, pair.tgt, cmp) : null), [cmp, pair, ticked]);
  const activeRow = active && cmp ? cmp.byId.get(active) ?? null : null;

  // the Diagram view only exists for flows: fall back to Summary for anything else
  const paneShown: Pane = pane === "flow" && activeRow?.type !== 29 ? "summary" : pane;

  const toggle = (r: CompareRow) => setTicked((t) => {
    const n = new Set(t); const on = !n.has(r.id);
    const ids = [r.id, ...(cmp?.rows.filter((c) => c.parent === r.id).map((c) => c.id) ?? [])];
    for (const id of ids) on ? n.add(id) : n.delete(id);
    return n;
  });
  const tickDeps = () => {
    if (!report) return;
    setTicked((t) => new Set([...t, ...report.needed.map((r) => r.id)]));
    setNotice(`Ticked ${report.needed.length} required item(s); ${report.alreadyInTarget} already in target; ${report.unverifiable} to verify; ${report.missing.length} missing everywhere.${report.truncated ? " Stopped after 6 levels." : ""}`);
  };
  const exportChecklist = () => {
    if (!cmp || !report) return;
    const rows = [...ticked].map((id) => cmp.byId.get(id)).filter(Boolean) as CompareRow[];
    downloadCsv("deployment-checklist.csv", [
      ["Section", "Type", "Name", "Key", "Status / required by"],
      ...rows.map((r) => ["Selected", r.typeName, r.name, r.key, STATUS_LABEL[r.status]]),
      ...report.needed.map((r) => ["Also needed", r.typeName, r.name, r.key, STATUS_LABEL[r.status]]),
      ...report.missing.map((m) => ["MISSING - blocks deployment", componentTypeName(m.ref.to.type), m.ref.to.key, m.ref.to.key, m.dependents.join("; ")]),
    ]);
  };
  const exportResults = () => cmp && downloadCsv("comparison.csv", [["Status", "Type", "Name", "Key", "Parent", "Changes"], ...cmp.rows.map((r) => [STATUS_LABEL[r.status], r.typeName, r.name, r.key, r.parent ?? "", r.changes.join(" | ")])]);

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input,button,select")) return;
    const i = tree.findIndex((t) => t.row.id === active);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const n = tree[Math.max(0, Math.min(tree.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]; if (n) setActive(n.row.id); }
    else if (e.key === " " && activeRow) { e.preventDefault(); toggle(activeRow); }
    else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && activeRow) setExpanded((s) => { const n = new Set(s); e.key === "ArrowRight" ? n.add(activeRow.id) : n.delete(activeRow.id); return n; });
  };

  const typeList = [...typeCounts].sort((a, b) => componentTypeName(a[0]).localeCompare(componentTypeName(b[0])));

  return (
    <div className="gs">
      <aside className="gs-side">
        <h3>Comparison</h3>
        <label className="muted">Source (what you deploy)</label>
        <SolutionPicker solutions={solutions} value={srcId || null} onChange={setSrcId} />
        <div className="gs-arrow" aria-hidden="true">↓</div>
        <label className="muted">Target (where it goes)</label>
        <SolutionPicker solutions={solutions} value={tgtId || null} onChange={setTgtId} />
        <button className="btn" disabled={!srcId || !tgtId || srcId === tgtId || busy} onClick={run}>{busy ? "Comparing…" : "Compare"}</button>
        {err && <p className="err" role="alert">{err}</p>}
        {cmp && (<>
          <h3>Compared types</h3>
          <ul className="gs-types">
            <li><button className={type === null ? "on" : ""} onClick={() => setType(null)}>All types <span className="pill">{[...typeCounts.values()].reduce((a, b) => a + b, 0)}</span></button></li>
            {typeList.map(([t, n]) => <li key={t}><button className={type === t ? "on" : ""} onClick={() => setType(t)}>{componentTypeName(t)} <span className="pill">{n}</span></button></li>)}
          </ul>
        </>)}
      </aside>

      <section className="gs-main">
        {!cmp && <div className="panel empty">Pick a source and a target, for example a new release against what is deployed, a patch against its parent, or dev against prod. Both must be loaded on the Solutions tab.</div>}
        {cmp && pair && (<>
          <div className="toolbar">
            <div className="seg" role="group" aria-label="Difference filter">{TABS.map(([id, label]) => <button key={id} aria-pressed={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label} {id === "all" ? cmp.rows.length : cmp.counts[id]}</button>)}</div>
            {(tab !== "all" || type !== null) && <button className="btn ghost sm" onClick={() => { setTab("all"); setType(null); }}>Clear tab and type</button>}
          </div>
          <TableToolbar api={tbl} total={cmp.rows.length} shown={tree.length} onExport={exportResults} />
          <p className="muted" style={{ margin: "0 0 8px" }}>{pair.src.uniqueName} {pair.src.version} <b>→</b> {pair.tgt.uniqueName} {pair.tgt.version}</p>

          {ticked.size > 0 && report && (
            <div className={`selbar${report.missing.length ? " bad" : ""}`}>
              <b>{ticked.size} ticked</b>
              <span>{report.needed.length} more required</span>
              <span className={report.missing.length ? "rem" : "add"}>{report.missing.length} missing everywhere</span>
              <span className="grow" />
              <button className="btn sm" disabled={!report.needed.length} onClick={tickDeps}>Tick dependencies</button>
              <button className="btn ghost sm" onClick={exportChecklist}>Export checklist</button>
              <button className="btn ghost sm" onClick={() => { setTicked(new Set()); setNotice(""); }}>Clear</button>
            </div>
          )}
          {notice && <div className="notice">{notice}</div>}
          {report && report.missing.length > 0 && (
            <div className="notice err" role="alert">
              <b>Deployment would be incomplete.</b> These required components exist in neither solution:
              <ul>{report.missing.map((m) => <li key={ck(m.ref.to.type, m.ref.to.key)}><span className="mono">{m.ref.to.key}</span> ({componentTypeName(m.ref.to.type)}) - needed by {m.dependents.slice(0, 3).join("; ")}{m.dependents.length > 3 ? "…" : ""}</li>)}</ul>
            </div>
          )}

          <div className="tablewrap gs-grid" tabIndex={0} onKeyDown={onKey} aria-label="Comparison results">
            <table className={`coltable${tbl.sized ? " sized" : ""}`} style={tbl.tableStyle(32)}><thead><tr><th style={{ width: 32 }} />{tbl.visible.map((c) => <ColumnHeader key={c.key} api={tbl} col={c} />)}</tr></thead>
              <tbody>
                {tree.map(({ row: r, depth, hasChildren, expanded: open }) => (
                  <tr key={r.id} className={`${r.id === active ? "sel" : ""}`} onClick={() => setActive(r.id)}>
                    <td style={{ paddingLeft: 8 + depth * 22, whiteSpace: "nowrap" }}>
                      {hasChildren ? <button className="caret" aria-label={open ? "Collapse" : "Expand"} onClick={(e) => { e.stopPropagation(); setExpanded((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; }); }}>{open ? "▾" : "▸"}</button> : <span className="caret-sp" />}
                      <input type="checkbox" checked={ticked.has(r.id)} onChange={() => toggle(r)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${r.name}`} />
                    </td>
                    {tbl.visible.map((c) => (
                      <td key={c.key} className={c.key === "type" ? "muted" : c.key === "details" ? "muted ell" : undefined}>
                        {c.key === "name" ? <><span className="mono">{r.name}</span>{r.name !== r.key && <span className="faint"> {r.key.split("/").pop()}</span>}</>
                          : c.key === "status" ? <StatusDot s={r.status} />
                          : c.key === "details" ? <>{r.changes.slice(0, 2).join(" · ")}{r.changes.length > 2 ? ` · +${r.changes.length - 2}` : ""}</>
                          : c.get(r)}
                      </td>
                    ))}
                  </tr>
                ))}
                {!tree.length && <tr><td colSpan={tbl.visible.length + 1} className="muted">Nothing matches these filters.</td></tr>}
              </tbody></table>
          </div>
          <ColumnMenuLayer api={tbl} rows={cmp.rows} />

          {activeRow && (
            <div className="gs-pane">
              <div className="toolbar">
                <b className="mono">{activeRow.name}</b><StatusDot s={activeRow.status} />
                <span className="grow" />
                <div className="seg" role="group" aria-label="Detail view">
                  <button aria-pressed={paneShown === "summary"} className={paneShown === "summary" ? "on" : ""} onClick={() => setPane("summary")}>Summary</button>
                  <button aria-pressed={paneShown === "deps"} className={paneShown === "deps" ? "on" : ""} onClick={() => setPane("deps")}>Dependencies</button>
                  {activeRow.type === 29 && <button aria-pressed={paneShown === "flow"} className={paneShown === "flow" ? "on" : ""} onClick={() => setPane("flow")}>Diagram</button>}
                </div>
              </div>
              {paneShown === "summary" && <SummaryPane row={activeRow} />}
              {paneShown === "deps" && <DepsPane row={activeRow} pair={pair} cmp={cmp} ticked={ticked} onTick={(ids) => setTicked((t) => new Set([...t, ...ids]))} onOpen={setActive} />}
              {paneShown === "flow" && <FlowPane row={activeRow} pair={pair} />}
            </div>
          )}
        </>)}
      </section>
    </div>
  );
}

function SummaryPane({ row }: { row: CompareRow }) {
  const keys = [...new Set([...Object.keys(row.src?.props ?? {}), ...Object.keys(row.tgt?.props ?? {})])];
  return (
    <div className="tablewrap"><table><thead><tr><th>Property</th><th>Target (deployed)</th><th>Source (new)</th></tr></thead><tbody>
      <tr><th>Key</th><td className="mono" colSpan={2}>{row.key}</td></tr>
      {keys.map((k) => { const a = row.tgt?.props[k], b = row.src?.props[k]; const diff = row.status === "different" && a !== b; return (
        <tr key={k} className={diff ? "chg" : ""}><th>{k}</th><td className={row.tgt && diff ? "tgt" : ""}>{a || "—"}</td><td className={row.src && diff ? "src" : ""}>{b || "—"}</td></tr>); })}
      {!keys.length && <tr><td colSpan={3} className="muted">No further properties.</td></tr>}
    </tbody></table></div>
  );
}

interface DepPaneRow { p: { type: number; key: string; name?: string }; kind: string; c?: CompareRow }
const DEP_PANE_COLUMNS: TableColumn<DepPaneRow>[] = [
  { key: "component", label: "Component", filter: "text", get: (x) => x.p.name || x.p.key, className: "mono" },
  { key: "type", label: "Type", filter: "set", get: (x) => componentTypeName(x.p.type), className: "muted" },
  { key: "relation", label: "Relation", filter: "set", get: (x) => x.kind, className: "muted" },
  { key: "status", label: "In comparison", filter: "set", get: (x) => (x.c ? STATUS_LABEL[x.c.status] : "Not in either"), render: (x) => (x.c ? <StatusDot s={x.c.status} /> : <span className="muted">Not in either</span>) },
];

function DepsPane({ row, pair, cmp, ticked, onTick, onOpen }: { row: CompareRow; pair: { src: ParsedSolution; tgt: ParsedSolution }; cmp: Comparison; ticked: Set<string>; onTick: (ids: string[]) => void; onOpen: (id: string) => void }) {
  const refs = useMemo(() => [...collectReferences(pair.src), ...collectReferences(pair.tgt)], [pair]);
  const uses = refs.filter((r) => ck(r.from.type, r.from.key) === row.id);
  const usedBy = refs.filter((r) => ck(r.to.type, r.to.key) === row.id);
  const dedupe = <T extends { kind: string; from: { type: number; key: string }; to: { type: number; key: string } }>(l: T[]) => [...new Map(l.map((r) => [`${r.kind}|${r.from.type}:${r.from.key}|${r.to.type}:${r.to.key}`, r])).values()];
  const needed = dedupe(uses).map((r) => cmp.byId.get(ck(r.to.type, r.to.key))).filter((x): x is CompareRow => !!x && (x.status === "new" || x.status === "different") && !ticked.has(x.id));
  const table = (id: string, title: string, list: typeof refs, side: "to" | "from") => {
    const rows = dedupe(list).map((r) => { const p = r[side]; return { p, kind: r.kind, c: cmp.byId.get(ck(p.type, p.key)) }; });
    return (<div><h2>{title} ({rows.length})</h2>
      <ColumnTable id={id} rows={rows} columns={DEP_PANE_COLUMNS} rowKey={(x) => `${x.p.type}:${x.p.key}|${x.kind}`} exportName={`${id}.csv`}
        onRowClick={(x) => { if (x.c) onOpen(x.c.id); }} rowClass={(x) => (x.c ? "" : "")} empty="None found." />
    </div>);
  };
  return (<div className="gs-deps">
    {needed.length > 0 && <div className="row"><button className="btn sm" onClick={() => onTick(needed.map((n) => n.id))}>Tick {needed.length} needed</button><span className="muted">New or different in source and required by this item.</span></div>}
    {table("compare.uses", "Uses", uses, "to")}
    {table("compare.usedby", "Used by - what changing or deleting it can affect", usedBy, "from")}
  </div>);
}

function FlowPane({ row, pair }: { row: CompareRow; pair: { src: ParsedSolution; tgt: ParsedSolution } }) {
  const find = (s: ParsedSolution): ParsedFlow | null => (s.flows ?? []).find((f) => ck(29, f.id) === row.id) ?? null;
  const src = find(pair.src), tgt = find(pair.tgt);
  if (!src && !tgt) return <div className="panel empty">No flow definition was found in the package (only flows exported as Workflows/*.json can be drawn).</div>;
  return (<div>
    <FlowDiagram flow={(src ?? tgt)!} against={src && tgt ? tgt : null} />
    {!src && <p className="muted">Only in target - shown as deployed.</p>}
  </div>);
}
