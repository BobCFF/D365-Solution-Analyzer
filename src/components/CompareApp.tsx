"use client";

import { useEffect, useMemo, useState } from "react";
import { analyzeSelection, compareSets, STATUS_LABEL, type CompareRow, type Comparison, type DiffStatus } from "@/lib/d365/comparison";
import { componentTypeName } from "@/lib/d365/componentTypes";
import { buildTree, countByType, type Tab } from "@/lib/d365/compareTree";
import { collectReferences, ck } from "@/lib/d365/dependencies";
import type { ParsedFlow, ParsedSolution } from "@/lib/d365/types";
import { FlowDiagram } from "./FlowDiagram";
import { downloadCsv } from "./ui";
import { SolutionPicker, type SolutionRow } from "./views";

type Pane = "summary" | "deps" | "flow";
const TABS: [Tab, string][] = [["all", "All items"], ["new", "New"], ["different", "Different"], ["deleted", "Deleted"], ["same", "Identical"]];

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
  const [srcId, setSrcId] = useState(""); const [tgtId, setTgtId] = useState("");
  const [pair, setPair] = useState<{ src: ParsedSolution; tgt: ParsedSolution } | null>(null);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("all"); const [type, setType] = useState<number | null>(null); const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("summary");
  const [notice, setNotice] = useState("");

  const run = async () => {
    setBusy(true); setErr(""); setTicked(new Set()); setActive(null); setNotice("");
    try { const [src, tgt] = await Promise.all([load(srcId), load(tgtId)]); setPair({ src, tgt }); onLogged(srcId, tgtId); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const cmp: Comparison | null = useMemo(() => (pair ? compareSets(pair.src, pair.tgt) : null), [pair]);
  const tree = useMemo(() => (cmp ? buildTree(cmp, { tab, type, q, expanded }) : []), [cmp, tab, type, q, expanded]);
  const typeCounts = useMemo(() => (cmp ? countByType(cmp, tab, q) : new Map<number, number>()), [cmp, tab, q]);
  const report = useMemo(() => (cmp && pair && ticked.size ? analyzeSelection([...ticked], pair.src, pair.tgt, cmp) : null), [cmp, pair, ticked]);
  const activeRow = active && cmp ? cmp.byId.get(active) ?? null : null;

  useEffect(() => { if (activeRow && activeRow.type !== 29 && pane === "flow") setPane("summary"); }, [activeRow, pane]);

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
            <div className="seg" role="tablist">{TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label} {id === "all" ? cmp.rows.length : cmp.counts[id]}</button>)}</div>
            <input type="search" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter" />
            {(tab !== "all" || type !== null || q) && <button className="btn ghost sm" onClick={() => { setTab("all"); setType(null); setQ(""); }}>Clear filters</button>}
            <span className="grow" />
            <button className="btn ghost" onClick={exportResults}>Export results</button>
          </div>
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
            <table><thead><tr><th style={{ width: 32 }} /><th>Name</th><th>Type</th><th>Difference</th><th>Details</th></tr></thead>
              <tbody>
                {tree.map(({ row: r, depth, hasChildren, expanded: open }) => (
                  <tr key={r.id} className={`${r.id === active ? "sel" : ""}`} onClick={() => setActive(r.id)}>
                    <td><input type="checkbox" checked={ticked.has(r.id)} onChange={() => toggle(r)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${r.name}`} /></td>
                    <td style={{ paddingLeft: 10 + depth * 22 }}>
                      {hasChildren ? <button className="caret" aria-label={open ? "Collapse" : "Expand"} onClick={(e) => { e.stopPropagation(); setExpanded((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; }); }}>{open ? "▾" : "▸"}</button> : <span className="caret-sp" />}
                      <span className="mono">{r.name}</span>{r.name !== r.key && <span className="faint"> {r.key.split("/").pop()}</span>}
                    </td>
                    <td className="muted">{r.typeName}</td>
                    <td><StatusDot s={r.status} /></td>
                    <td className="muted ell">{r.changes.slice(0, 2).join(" · ")}{r.changes.length > 2 ? ` · +${r.changes.length - 2}` : ""}</td>
                  </tr>
                ))}
                {!tree.length && <tr><td colSpan={5} className="muted">Nothing matches these filters.</td></tr>}
              </tbody></table>
          </div>

          {activeRow && (
            <div className="gs-pane">
              <div className="toolbar">
                <b className="mono">{activeRow.name}</b><StatusDot s={activeRow.status} />
                <span className="grow" />
                <div className="seg" role="tablist">
                  <button className={pane === "summary" ? "on" : ""} onClick={() => setPane("summary")}>Summary</button>
                  <button className={pane === "deps" ? "on" : ""} onClick={() => setPane("deps")}>Dependencies</button>
                  {activeRow.type === 29 && <button className={pane === "flow" ? "on" : ""} onClick={() => setPane("flow")}>Diagram</button>}
                </div>
              </div>
              {pane === "summary" && <SummaryPane row={activeRow} />}
              {pane === "deps" && <DepsPane row={activeRow} pair={pair} cmp={cmp} ticked={ticked} onTick={(ids) => setTicked((t) => new Set([...t, ...ids]))} onOpen={setActive} />}
              {pane === "flow" && <FlowPane row={activeRow} pair={pair} />}
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

function DepsPane({ row, pair, cmp, ticked, onTick, onOpen }: { row: CompareRow; pair: { src: ParsedSolution; tgt: ParsedSolution }; cmp: Comparison; ticked: Set<string>; onTick: (ids: string[]) => void; onOpen: (id: string) => void }) {
  const refs = useMemo(() => [...collectReferences(pair.src), ...collectReferences(pair.tgt)], [pair]);
  const uses = refs.filter((r) => ck(r.from.type, r.from.key) === row.id);
  const usedBy = refs.filter((r) => ck(r.to.type, r.to.key) === row.id);
  const dedupe = <T extends { kind: string; from: { type: number; key: string }; to: { type: number; key: string } }>(l: T[]) => [...new Map(l.map((r) => [`${r.kind}|${r.from.type}:${r.from.key}|${r.to.type}:${r.to.key}`, r])).values()];
  const needed = dedupe(uses).map((r) => cmp.byId.get(ck(r.to.type, r.to.key))).filter((x): x is CompareRow => !!x && (x.status === "new" || x.status === "different") && !ticked.has(x.id));
  const table = (title: string, list: typeof refs, side: "to" | "from") => (
    <div><h2>{title} ({dedupe(list).length})</h2>
      <div className="tablewrap"><table><thead><tr><th>Component</th><th>Type</th><th>Relation</th><th>In comparison</th></tr></thead><tbody>
        {dedupe(list).map((r, i) => { const p = r[side]; const c = cmp.byId.get(ck(p.type, p.key)); return (
          <tr key={i} onClick={() => c && onOpen(c.id)} className={c ? "clickable" : ""}><td className="mono">{("name" in p && (p as { name?: string }).name) || p.key}</td><td className="muted">{componentTypeName(p.type)}</td><td className="muted">{r.kind}</td><td>{c ? <StatusDot s={c.status} /> : <span className="muted">Not in either</span>}</td></tr>); })}
        {!list.length && <tr><td colSpan={4} className="muted">None found.</td></tr>}
      </tbody></table></div></div>
  );
  return (<div className="gs-deps">
    {needed.length > 0 && <div className="row"><button className="btn sm" onClick={() => onTick(needed.map((n) => n.id))}>Tick {needed.length} needed</button><span className="muted">New or different in source and required by this item.</span></div>}
    {table("Uses", uses, "to")}
    {table("Used by - what changing or deleting it can affect", usedBy, "from")}
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
