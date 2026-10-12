"use client";

import { useMemo, useState } from "react";
import type { AccessLevel, ParsedSolution } from "@/lib/d365/types";
import { useEffect } from "react";
import type { Api } from "@/lib/api-client";
import { errMsg } from "@/lib/api-client";
import { categoryOf, filterFindings, isSystemSolution } from "@/lib/d365/findingMeta";
import { downloadCsv, SEV_ORDER } from "./ui";

export interface SolutionRow { id: string; unique_name: string; friendly_name: string; version: string; managed: boolean; parent_solution_name: string | null; file_name: string; created_at: string }
export interface FindingRow { id: number; rule_id: string; severity: "error" | "warning" | "info"; title: string; detail: string; remediation: string | null; solutions?: string[] }
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

const HIDE_SYSTEM_KEY = "d365-sa-hide-system";
function readHideSystem(): boolean { try { return localStorage.getItem(HIDE_SYSTEM_KEY) === "1"; } catch { return false; } }

/**
 * Findings with filters: severity, category, text, and the other solutions a finding refers to (required solution,
 * overlapping solution, patch parent). Microsoft/system solutions can be hidden in one click, or solutions picked
 * individually. Findings that do not reference another solution are always shown.
 */
export function AnalysisView({ findings, onRerun, busy }: { findings: FindingRow[]; onRerun: () => void; busy: boolean }) {
  const [sev, setSev] = useState<"all" | FindingRow["severity"]>("all");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [hideSystem, setHideSystem] = useState(readHideSystem);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const refs = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of findings) for (const n of f.solutions ?? []) m.set(n, (m.get(n) ?? 0) + 1);
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [findings]);
  const included = (name: string) => !excluded.has(name) && !(hideSystem && isSystemSolution(name));
  const categories = useMemo(() => [...new Set(findings.map((f) => categoryOf(f.rule_id)))].sort(), [findings]);

  const shown = useMemo(
    () => filterFindings(findings, { category, q, excluded, hideSystem }).sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]),
    [findings, category, q, excluded, hideSystem],
  );

  const bySev = filterFindings(shown, { severity: sev });
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of shown) counts[f.severity]++;
  const hidden = findings.length - shown.length;
  const filtered = Boolean(category || q || excluded.size || hideSystem || sev !== "all");
  const toggleSolution = (n: string) => setExcluded((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x; });
  const setHide = (v: boolean) => { setHideSystem(v); try { localStorage.setItem(HIDE_SYSTEM_KEY, v ? "1" : "0"); } catch { /* storage unavailable */ } };
  const clear = () => { setSev("all"); setCategory(""); setQ(""); setExcluded(new Set()); setHide(false); };
  const includedCount = refs.filter(([n]) => included(n)).length;

  return (<div>
    <div className="toolbar">
      <div className="summary" style={{ margin: 0 }}>
        <span className="chip error">{counts.error} errors</span><span className="chip warning">{counts.warning} warnings</span><span className="chip info">{counts.info} info</span>
      </div>
      <span className="grow" />
      <button className="btn ghost" disabled={busy} onClick={onRerun} title="Re-check against everything currently loaded (e.g. after loading a parent solution)">Re-run</button>
      <button className="btn ghost" disabled={!bySev.length} onClick={() => downloadCsv("findings.csv", [["Rule", "Category", "Severity", "Title", "Detail", "Remediation", "Referenced solutions"], ...bySev.map((f) => [f.rule_id, categoryOf(f.rule_id), f.severity, f.title, f.detail, f.remediation ?? "", (f.solutions ?? []).join("; ")])])}>Export CSV{filtered ? " (filtered)" : ""}</button>
    </div>
    <div className="toolbar filters">
      <div className="seg" role="group" aria-label="Severity filter">{(["all", "error", "warning", "info"] as const).map((v) => <button key={v} aria-pressed={sev === v} className={sev === v ? "on" : ""} onClick={() => setSev(v)}>{v}</button>)}</div>
      <input type="search" placeholder="Search findings…" aria-label="Search findings" value={q} onChange={(e) => setQ(e.target.value)} />
      <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="">All categories</option>{categories.map((c) => <option key={c}>{c}</option>)}
      </select>
      <details className="multi">
        <summary className="btn ghost" aria-label="Filter by referenced solutions">Solutions ({refs.length ? `${includedCount} of ${refs.length}` : "none referenced"})</summary>
        <div className="multi-pop" role="group" aria-label="Referenced solutions">
          <label className="row"><input type="checkbox" checked={hideSystem} onChange={(e) => setHide(e.target.checked)} /> <b>Hide Microsoft / system solutions</b></label>
          <p className="faint" style={{ margin: "4px 0 8px" }}>Findings that don&apos;t refer to another solution are always shown.</p>
          {refs.length > 0 && <div className="row"><button className="btn ghost sm" onClick={() => setExcluded(new Set())}>Select all</button><button className="btn ghost sm" onClick={() => setExcluded(new Set(refs.map(([n]) => n)))}>Select none</button></div>}
          <ul>{refs.map(([n, c]) => (
            <li key={n}><label className="row"><input type="checkbox" checked={included(n)} disabled={hideSystem && isSystemSolution(n)} onChange={() => toggleSolution(n)} /> <span className="mono">{n}</span> <span className="pill">{c}</span>{isSystemSolution(n) && <span className="faint"> Microsoft/system</span>}</label></li>
          ))}</ul>
          {!refs.length && <p className="muted">None of the findings refer to another solution.</p>}
        </div>
      </details>
      {filtered && <button className="btn ghost sm" onClick={clear}>Clear filters</button>}
    </div>
    {hidden > 0 && <p className="muted" role="status">{hidden} finding(s) hidden by the solution and category filters.</p>}
    {!findings.length && <div className="panel empty"><span className="chip ok">No issues found</span></div>}
    {findings.length > 0 && !bySev.length && <div className="panel empty">No findings match these filters.</div>}
    {bySev.map((f) => (
      <div className={`finding ${f.severity}`} key={f.id}>
        <b>{f.title}</b> <span className="rule">{f.rule_id}</span> <span className="faint">{categoryOf(f.rule_id)}</span>
        {(f.solutions?.length ?? 0) > 0 && <span className="faint"> · solution{f.solutions!.length > 1 ? "s" : ""}: {f.solutions!.join(", ")}</span>}
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

interface Health { version: string; encryption: boolean; allowList: boolean; tables: { table: string; ok: boolean; hint?: string }[]; config: { level: "error" | "warn"; message: string }[] }

export function LogView({ log, version, api, onPurge }: { log: LogRow[]; version: string; api: Api; onPurge: () => void }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { api<Health>("/api/health").then(setHealth).catch((e) => setMsg(errMsg(e))); }, [api]);
  const exportData = async () => {
    try {
      const data = await api("/api/account/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = "d365-solution-analyzer-export.json"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setMsg(errMsg(e)); }
  };
  const problems = health ? [...health.config, ...health.tables.filter((t) => !t.ok).map((t) => ({ level: "error" as const, message: `Table "${t.table}" is missing. ${t.hint}` })), ...(health.encryption ? [] : [{ level: "error" as const, message: "Encryption self-test failed (check DATA_ENCRYPTION_KEY)." }])] : [];
  return (<div>
    <div className="panel">
      <h2>Status</h2>
      {!health && !msg && <p className="muted">Checking…</p>}
      {msg && <p className="err" role="alert">{msg}</p>}
      {health && (<>
        <p>{problems.some((p) => p.level === "error") ? <span className="chip error">Needs attention</span> : <span className="chip ok">Ready</span>} <span className="muted">v{version} · encryption {health.encryption ? "ok" : "failed"} · database {health.tables.every((t) => t.ok) ? "ok" : "incomplete"} · access {health.allowList ? "restricted to ALLOWED_EMAILS" : "any signed-in account"}</span></p>
        {problems.length > 0 && <ul>{problems.map((p, i) => <li key={i} className={p.level === "error" ? "err" : "muted"}>{p.level === "error" ? "✗" : "⚠"} {p.message}</li>)}</ul>}
      </>)}
    </div>
    <div className="panel">
      <h2>Your data</h2>
      <p className="muted">Solution metadata, findings, comparisons and this history are encrypted before storage and visible only to your account. Download everything we hold, or erase it.</p>
      <div className="row"><button className="btn ghost" onClick={exportData}>Download my data (JSON)</button><button className="btn danger" onClick={onPurge}>Delete all my data…</button></div>
    </div>
    <h2>Activity</h2>
    <p className="muted">Audit trail of actions in this workspace (stored encrypted). Project release notes are in CHANGELOG.md.</p>
    <div className="tablewrap"><table><thead><tr><th>When</th><th>Action</th><th>Summary</th><th>App</th></tr></thead>
      <tbody>{log.map((l) => <tr key={l.id}><td className="muted">{new Date(l.created_at).toLocaleString()}</td><td>{l.action}</td><td>{l.summary}</td><td className="muted">v{l.app_version}</td></tr>)}
        {!log.length && <tr><td colSpan={4} className="muted">No activity yet.</td></tr>}</tbody></table></div>
  </div>);
}
