"use client";

import { useMemo, useState } from "react";
import type { SolutionComparison } from "@/lib/d365/compare";
import type { AccessLevel, ParsedSolution } from "@/lib/d365/types";
import { downloadCsv, SEV_ORDER } from "./ui";

export interface SolutionRow { id: string; unique_name: string; friendly_name: string; version: string; managed: boolean; parent_solution_name: string | null; file_name: string; created_at: string }
export interface FindingRow { id: number; rule_id: string; severity: "error" | "warning" | "info"; title: string; detail: string; remediation: string | null }
export interface LogRow { id: number; action: string; summary: string; app_version: string | null; created_at: string }

export const solutionLabel = (s: SolutionRow) => `${s.unique_name} ${s.version} (${s.managed ? "managed" : "unmanaged"}${s.parent_solution_name ? ", patch" : ""})`;

export function SolutionPicker({ solutions, value, onChange }: { solutions: SolutionRow[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} aria-label="Solution">
      <option value="" disabled>Choose a solution…</option>
      {solutions.map((s) => <option key={s.id} value={s.id}>{solutionLabel(s)}</option>)}
    </select>
  );
}

export function SolutionsView({ solutions, selected, onSelect, onDelete }: {
  solutions: SolutionRow[]; selected: string | null; onSelect: (id: string) => void; onDelete: (s: SolutionRow) => void;
}) {
  if (!solutions.length) return <div className="panel empty">Nothing loaded yet. Drop a solution .zip above to begin.</div>;
  return (
    <div className="tablewrap"><table>
      <thead><tr><th>Solution</th><th>Version</th><th>Type</th><th>File</th><th>Loaded</th><th /></tr></thead>
      <tbody>{solutions.map((s) => (
        <tr key={s.id} className={s.id === selected ? "sel" : ""}>
          <td>{s.friendly_name}<div className="muted mono">{s.unique_name}</div></td>
          <td className="mono">{s.version}</td>
          <td>{s.managed ? "Managed" : "Unmanaged"}{s.parent_solution_name && <div className="muted">Patch of {s.parent_solution_name}</div>}</td>
          <td className="muted">{s.file_name}</td>
          <td className="muted">{new Date(s.created_at).toLocaleString()}</td>
          <td><div className="row"><button className="btn sm" onClick={() => onSelect(s.id)}>Analyze</button><button className="btn danger sm" onClick={() => onDelete(s)}>Delete</button></div></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

export function AnalysisView({ findings, onRerun, busy }: { findings: FindingRow[]; onRerun: () => void; busy: boolean }) {
  const [sev, setSev] = useState<"all" | FindingRow["severity"]>("all");
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const shown = findings.filter((f) => sev === "all" || f.severity === sev).sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  return (<div>
    <div className="toolbar">
      <div className="summary" style={{ margin: 0 }}>
        <span className="chip error">{counts.error} errors</span><span className="chip warning">{counts.warning} warnings</span><span className="chip info">{counts.info} info</span>
      </div>
      <span className="grow" />
      <div className="seg">{(["all", "error", "warning", "info"] as const).map((v) => <button key={v} className={sev === v ? "on" : ""} onClick={() => setSev(v)}>{v}</button>)}</div>
      <button className="btn ghost" disabled={busy} onClick={onRerun} title="Re-check against everything currently loaded (e.g. after loading a parent solution)">Re-run</button>
      <button className="btn ghost" disabled={!findings.length} onClick={() => downloadCsv("findings.csv", [["Rule", "Severity", "Title", "Detail", "Remediation"], ...findings.map((f) => [f.rule_id, f.severity, f.title, f.detail, f.remediation ?? ""])])}>Export CSV</button>
    </div>
    {!findings.length && <div className="panel empty"><span className="chip ok">No issues found</span></div>}
    {shown.map((f) => (
      <div className={`finding ${f.severity}`} key={f.id}>
        <b>{f.title}</b> <span className="rule">{f.rule_id}</span>
        <div>{f.detail}</div>{f.remediation && <div className="fix">Fix: {f.remediation}</div>}
      </div>
    ))}
  </div>);
}

type SortKey = "table" | "column" | "display" | "type" | "required" | "fk";
export function DictionaryView({ sol }: { sol: ParsedSolution }) {
  const [q, setQ] = useState(""); const [table, setTable] = useState(""); const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "table", dir: 1 });
  const rows = useMemo(() => (sol.entities ?? []).flatMap((e) => e.attributes.map((a) => ({
    table: e.logical, column: a.name, display: a.display, type: a.type, required: a.required, fk: (a.targets ?? []).join(", "),
    pk: !!a.pk, custom: a.custom, secured: a.secured, optionSet: a.optionSet ?? "",
  }))), [sol]);
  const tables = useMemo(() => (sol.entities ?? []).map((e) => e.logical).sort(), [sol]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => (!table || r.table === table) && (!needle || `${r.table} ${r.column} ${r.display} ${r.type} ${r.fk}`.toLowerCase().includes(needle)))
      .sort((a, b) => (a[sort.k] < b[sort.k] ? -1 : a[sort.k] > b[sort.k] ? 1 : 0) * sort.dir);
  }, [rows, q, table, sort]);
  if (!rows.length) return <div className="panel empty">No table definitions in this package (the solution may contain only shell or non-table components).</div>;
  const th = (k: SortKey, label: string) => (
    <th className="sortable" onClick={() => setSort((s) => ({ k, dir: s.k === k ? (-s.dir as 1 | -1) : 1 }))} aria-sort={sort.k === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      {label}{sort.k === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );
  return (<div>
    <div className="toolbar">
      <input type="search" placeholder="Search columns…" value={q} onChange={(e) => setQ(e.target.value)} />
      <select value={table} onChange={(e) => setTable(e.target.value)} aria-label="Table"><option value="">All tables ({tables.length})</option>{tables.map((t) => <option key={t}>{t}</option>)}</select>
      <span className="muted">{shown.length} of {rows.length} columns</span><span className="grow" />
      <button className="btn ghost" onClick={() => downloadCsv(`${sol.uniqueName}-dictionary.csv`, [["Table", "Column", "Display name", "Type", "Required", "PK", "Lookup targets", "Custom", "Secured", "Option set"], ...shown.map((r) => [r.table, r.column, r.display, r.type, r.required, r.pk, r.fk, r.custom, r.secured, r.optionSet])])}>Export CSV</button>
    </div>
    <div className="tablewrap"><table>
      <thead><tr>{th("table", "Table")}{th("column", "Column")}{th("display", "Display name")}{th("type", "Type")}{th("required", "Required")}{th("fk", "Lookup → ")}</tr></thead>
      <tbody>{shown.slice(0, 2000).map((r) => (
        <tr key={r.table + r.column}><td className="mono">{r.table}</td><td className="mono">{r.column}{r.pk && " 🔑"}{r.secured && " 🔒"}</td><td>{r.display}</td><td>{r.type}</td><td>{r.required}</td><td className="mono">{r.fk}</td></tr>
      ))}</tbody>
    </table></div>
    {shown.length > 2000 && <p className="muted">Showing the first 2,000 rows; narrow the filter or export CSV for all.</p>}
  </div>);
}

const VERBS = ["create", "read", "write", "delete", "append", "appendto", "assign", "share"];
const VERB_LABEL: Record<string, string> = { create: "Create", read: "Read", write: "Write", delete: "Delete", append: "Append", appendto: "Append To", assign: "Assign", share: "Share" };
const LVL_LABEL: Record<AccessLevel, string> = { none: "—", user: "User", bu: "BU", deep: "Deep", org: "Org" };

export function SecurityView({ sol }: { sol: ParsedSolution }) {
  const roles = sol.roles ?? [], profiles = sol.fieldProfiles ?? [];
  const [mode, setMode] = useState<"roles" | "fields">(roles.length ? "roles" : "fields");
  const [role, setRole] = useState(roles[0]?.name ?? ""); const [profile, setProfile] = useState(profiles[0]?.name ?? ""); const [q, setQ] = useState("");
  if (!roles.length && !profiles.length) return <div className="panel empty">No security roles or field security profiles in this package.</div>;
  const r = roles.find((x) => x.name === role); const p = profiles.find((x) => x.name === profile);
  const ents = new Set((sol.entities ?? []).map((e) => e.logical));
  return (<div>
    <div className="toolbar">
      <div className="seg">
        {roles.length > 0 && <button className={mode === "roles" ? "on" : ""} onClick={() => setMode("roles")}>Table privileges</button>}
        {profiles.length > 0 && <button className={mode === "fields" ? "on" : ""} onClick={() => setMode("fields")}>Field security</button>}
      </div>
      {mode === "roles" ? <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">{roles.map((x) => <option key={x.name}>{x.name}</option>)}</select>
        : <select value={profile} onChange={(e) => setProfile(e.target.value)} aria-label="Profile">{profiles.map((x) => <option key={x.name}>{x.name}</option>)}</select>}
      <input type="search" placeholder="Filter tables…" value={q} onChange={(e) => setQ(e.target.value)} />
    </div>
    {mode === "roles" && r && (
      <div className="tablewrap"><table>
        <thead><tr><th>Table</th>{VERBS.map((v) => <th key={v}>{VERB_LABEL[v]}</th>)}</tr></thead>
        <tbody>{Object.entries(r.privileges).filter(([t]) => t.includes(q.toLowerCase())).sort(([a], [b]) => a.localeCompare(b)).map(([t, pv]) => (
          <tr key={t}><td className="mono">{t}{!ents.has(t) && t.includes("_") && <span className="err" title="Table is not in this solution"> ⚠</span>}</td>
            {VERBS.map((v) => <td key={v}><span className={`lvl ${pv[v] ?? "none"}`}>{LVL_LABEL[(pv[v] ?? "none") as AccessLevel]}</span></td>)}</tr>
        ))}</tbody>
      </table></div>
    )}
    {mode === "fields" && p && (
      <div className="tablewrap"><table>
        <thead><tr><th>Table</th><th>Column</th><th>Read</th><th>Create</th><th>Update</th></tr></thead>
        <tbody>{p.permissions.filter((x) => x.entity.includes(q.toLowerCase())).map((x) => (
          <tr key={x.entity + x.attribute}><td className="mono">{x.entity}</td><td className="mono">{x.attribute}</td><td>{x.read ? "✓" : "—"}</td><td>{x.create ? "✓" : "—"}</td><td>{x.update ? "✓" : "—"}</td></tr>
        ))}</tbody>
      </table></div>
    )}
  </div>);
}

export function CompareView({ solutions, onCompare, result, busy }: {
  solutions: SolutionRow[]; onCompare: (l: string, r: string) => void; result: SolutionComparison | null; busy: boolean;
}) {
  const [l, setL] = useState(""); const [r, setR] = useState("");
  const list = (title: string, items: { typeName: string; key: string; displayName?: string; changes?: string[] }[], cls: string) => items.length > 0 && (
    <div className="panel"><h2 className={cls}>{title} ({items.length})</h2>
      <ul>{items.map((i) => <li key={i.typeName + i.key}>{i.typeName}: <span className="mono">{i.displayName || i.key}</span>{i.changes && <ul>{i.changes.map((c) => <li key={c}>{c}</li>)}</ul>}</li>)}</ul></div>
  );
  return (<div>
    <div className="toolbar">
      <SolutionPicker solutions={solutions} value={l || null} onChange={setL} />
      <span className="muted">→</span>
      <SolutionPicker solutions={solutions} value={r || null} onChange={setR} />
      <button className="btn" disabled={!l || !r || l === r || busy} onClick={() => onCompare(l, r)}>Compare</button>
    </div>
    {!result && <div className="panel empty">Pick a base and a target solution (for example a release and its patch, or dev vs. prod).</div>}
    {result && (<>
      <p className="muted">{result.left.uniqueName} {result.left.version} → {result.right.uniqueName} {result.right.version} · {result.unchangedCount} unchanged</p>
      {result.metadata.length > 0 && <div className="panel"><h2>Metadata</h2><ul>{result.metadata.map((m) => <li key={m.field}><b>{m.field}</b>: {m.left || "—"} → {m.right || "—"}</li>)}</ul></div>}
      {list("Added", result.added, "add")}{list("Removed", result.removed, "rem")}{list("Changed", result.changed, "chg")}
      {(result.columns ?? []).length > 0 && (
        <div className="panel"><h2>Column changes ({result.columns.length})</h2>
          <div className="tablewrap"><table><thead><tr><th>Table</th><th>Column</th><th>Change</th><th>Detail</th></tr></thead><tbody>
            {result.columns.map((c, i) => (
              <tr key={i}><td className="mono">{c.table}</td><td className="mono">{c.column}</td>
                <td className={c.change === "added" ? "add" : c.change === "removed" || c.change === "type" ? "rem" : "chg"}>{c.change}{c.change === "type" && " ⚠ breaking"}</td>
                <td>{c.from !== undefined ? `${c.from || "—"} → ${c.to || "—"}` : ""}</td></tr>
            ))}</tbody></table></div></div>
      )}
      {result.roles && (result.roles.added.length > 0 || result.roles.removed.length > 0) && (
        <div className="panel"><h2>Security roles</h2><ul>{result.roles.added.map((n) => <li key={"a" + n} className="add">+ {n}</li>)}{result.roles.removed.map((n) => <li key={"r" + n} className="rem">− {n}</li>)}</ul></div>
      )}
      {!result.added.length && !result.removed.length && !result.changed.length && !(result.columns ?? []).length && <div className="panel empty">No differences found.</div>}
    </>)}
  </div>);
}

export function LogView({ log, version }: { log: LogRow[]; version: string }) {
  return (<div>
    <p className="muted">Audit trail of actions in this workspace. Project release notes are in CHANGELOG.md. Running v{version}.</p>
    <div className="tablewrap"><table><thead><tr><th>When</th><th>Action</th><th>Summary</th><th>App</th></tr></thead>
      <tbody>{log.map((l) => <tr key={l.id}><td className="muted">{new Date(l.created_at).toLocaleString()}</td><td>{l.action}</td><td>{l.summary}</td><td className="muted">v{l.app_version}</td></tr>)}
        {!log.length && <tr><td colSpan={4} className="muted">No activity yet.</td></tr>}</tbody></table></div>
  </div>);
}
