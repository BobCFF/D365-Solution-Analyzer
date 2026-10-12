"use client";

import { useEffect, useMemo, useState } from "react";
import type { AccessLevel, ParsedSolution } from "@/lib/d365/types";
import type { Api } from "@/lib/api-client";
import { errMsg } from "@/lib/api-client";
import { categoryOf, filterFindings, isSystemSolution } from "@/lib/d365/findingMeta";
import { ColumnTable, type TableColumn } from "./ColumnTable";
import type { MissingRow } from "@/lib/d365/missingDeps";
import type { TargetResult } from "@/lib/d365/targetCheck";
import { asBool, asOneOf, asString, asStringArray } from "@/lib/uiStateStore";
import { useSavedState } from "./uiState";
import { downloadCsv, MenuButton, SEV_ORDER } from "./ui";

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

const typeOf = (s: SolutionRow) => `${s.managed ? "Managed" : "Unmanaged"}${s.parent_solution_name ? " patch" : ""}`;
const SOLUTION_COLUMNS: TableColumn<SolutionRow>[] = [
  { key: "solution", label: "Solution", filter: "text", get: (s) => `${s.friendly_name} ${s.unique_name}`, render: (s) => <>{s.friendly_name}<div className="muted mono">{s.unique_name}</div></> },
  { key: "version", label: "Version", filter: "set", get: (s) => s.version, className: "mono" },
  { key: "type", label: "Type", filter: "set", get: typeOf, render: (s) => <>{typeOf(s)}{s.parent_solution_name && <div className="muted">of {s.parent_solution_name}</div>}</> },
  { key: "parent", label: "Patch parent", filter: "set", defaultVisible: false, get: (s) => s.parent_solution_name ?? "" },
  { key: "file", label: "File", filter: "text", get: (s) => s.file_name, className: "muted" },
  { key: "loaded", label: "Loaded", filter: "text", get: (s) => new Date(s.created_at).toLocaleString(), sortValue: (s) => s.created_at, className: "muted" },
];

export function SolutionsView({ solutions, selected, onSelect, onDelete }: {
  solutions: SolutionRow[]; selected: string | null; onSelect: (id: string) => void; onDelete: (s: SolutionRow) => void;
}) {
  if (!solutions.length) return <div className="panel empty">Nothing loaded yet. Drop a solution .zip above to begin.</div>;
  return (
    <ColumnTable id="solutions" rows={solutions} columns={SOLUTION_COLUMNS} rowKey={(s) => s.id} exportName="solutions.csv" rowClass={(s) => (s.id === selected ? "sel" : "")} initialSort={{ key: "loaded", dir: -1 }}
      actionsLabel="Actions" rowActions={(s) => <div className="row"><button className="btn sm" onClick={() => onSelect(s.id)}>Analyze</button><button className="btn danger sm" onClick={() => onDelete(s)}>Delete</button></div>} />
  );
}

interface AnalysisPrefs { view: "auto" | "missing" | "findings"; sev: "all" | "error" | "warning" | "info"; category: string; q: string; hideSystem: boolean; excluded: string[] }
const ANALYSIS_DEFAULT: AnalysisPrefs = { view: "auto", sev: "all", category: "", q: "", hideSystem: false, excluded: [] };
function normalizeAnalysis(raw: unknown): AnalysisPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    view: asOneOf(r.view, ["auto", "missing", "findings"] as const, "auto"), sev: asOneOf(r.sev, ["all", "error", "warning", "info"] as const, "all"),
    category: asString(r.category), q: asString(r.q), hideSystem: asBool(r.hideSystem), excluded: asStringArray(r.excluded),
  };
}

const sevRank = { error: 0, warning: 1, info: 2 } as const;
const MISSING_COLUMNS: TableColumn<MissingRow>[] = [
  { key: "severity", label: "Severity", filter: "set", get: (r) => r.severity, sortValue: (r) => sevRank[r.severity], render: (r) => <span className={`sev ${r.severity}`}>{r.severity}</span> },
  { key: "status", label: "Status", filter: "set", defaultVisible: false, get: (r) => (r.status === "missing" ? "Missing" : "To verify") },
  { key: "reqType", label: "Required type", filter: "set", get: (r) => r.requiredType },
  { key: "reqName", label: "Required component", filter: "text", get: (r) => [r.requiredName, r.requiredKey && r.requiredKey !== r.requiredName ? r.requiredKey : ""].filter(Boolean).join(" "),
    render: (r) => <><span className="mono">{r.requiredName}</span>{r.requiredKey && r.requiredKey !== r.requiredName && <div className="faint mono">{r.requiredKey}</div>}</> },
  { key: "reqParent", label: "Parent of required", filter: "text", defaultVisible: false, get: (r) => r.requiredParent ?? "" },
  { key: "reqSolution", label: "Required solution", filter: "set", get: (r) => r.requiredSolution ?? "",
    render: (r) => r.requiredSolution ? <><span className="mono">{r.requiredSolution}</span>{r.requiredSolutionVersion && <span className="muted"> {r.requiredSolutionVersion}</span>}{isSystemSolution(r.requiredSolution) && <div className="faint">Microsoft/system</div>}</> : <span className="faint">unknown</span> },
  { key: "avail", label: "Availability", filter: "set", get: (r) => (r.availability === "loaded" ? "Solution loaded" : r.availability === "not-loaded" ? "Not loaded" : r.source === "scan" ? "Not in any loaded solution" : "Unknown"),
    render: (r) => <span className={`chip ${r.availability === "loaded" ? "ok" : "warning"}`}>{r.availability === "loaded" ? "Solution loaded" : r.availability === "not-loaded" ? "Not loaded" : r.source === "scan" ? "Not in any loaded solution" : "Unknown"}</span> },
  { key: "target", label: "In target environment", filter: "set", get: (r) => (r.target?.state === "present" ? "Present" : r.target?.state === "absent" ? "Missing in target" : "Not checked"),
    render: (r) => <><span className={`chip ${r.target?.state === "present" ? "ok" : r.target?.state === "absent" ? "error" : "info"}`}>{r.target?.state === "present" ? "Present" : r.target?.state === "absent" ? "Missing in target" : "Not checked"}</span>{r.target?.note && <div className="faint">{r.target.note}</div>}</> },
  { key: "depType", label: "Required by (type)", filter: "set", defaultVisible: false, get: (r) => r.dependentType },
  { key: "depName", label: "Required by", filter: "text", get: (r) => `${r.dependentType} ${r.dependentName} ${r.where ?? ""}`.trim(),
    render: (r) => <><span className="muted">{r.dependentType}</span> <span className="mono">{r.dependentName}</span>{r.where && <div className="faint">{r.where}</div>}</> },
  { key: "relation", label: "Relationship", filter: "set", defaultVisible: false, get: (r) => r.relation ?? "" },
  { key: "source", label: "Source", filter: "set", defaultVisible: false, get: (r) => (r.source === "manifest" ? "Platform report (solution.xml)" : "Reference scan") },
  { key: "fix", label: "How to fix", filter: "text", className: "wrap", get: (r) => r.fix },
];

/**
 * Analysis page. Primary view: one parsed row per missing dependency (platform-reported plus reference scan), with a
 * filter under every column. Second view: all findings with severity/category/text filters. The Solutions dropdown
 * (referenced / required solutions, hide Microsoft-system) applies to both.
 */
export function AnalysisView({ findings, missing, depsLoading, onRerun, busy, connections, onVerify, targetInfo, onOpenEnvironments }: {
  findings: FindingRow[]; missing: MissingRow[]; depsLoading: boolean; onRerun: () => void; busy: boolean;
  connections: { id: string; name: string }[]; onVerify: (connectionId: string) => void; targetInfo: TargetResult | null; onOpenEnvironments: () => void;
}) {
  const [connId, setConnId] = useSavedState<string>("analysis.conn", "", (r) => asString(r));
  const chosenConn = connections.some((c) => c.id === connId) ? connId : connections[0]?.id ?? "";
  // remembered per user: which view, the filters and the solution selection
  const [prefs, setPrefs] = useSavedState<AnalysisPrefs>("analysis", ANALYSIS_DEFAULT, normalizeAnalysis);
  const { view, sev, category, q, hideSystem } = prefs;
  const excluded = useMemo(() => new Set(prefs.excluded), [prefs.excluded]);
  const patch = (p: Partial<AnalysisPrefs>) => setPrefs((cur) => ({ ...cur, ...p }));
  const setView = (v: AnalysisPrefs["view"]) => patch({ view: v });
  const setSev = (v: AnalysisPrefs["sev"]) => patch({ sev: v });
  const setCategory = (v: string) => patch({ category: v });
  const setQ = (v: string) => patch({ q: v });
  const setExcluded = (s: Set<string>) => patch({ excluded: [...s] });
  const active = view === "auto" ? (missing.length ? "missing" : "findings") : view;

  const refs = useMemo(() => {
    const m = new Map<string, number>();
    if (active === "missing") { for (const r of missing) if (r.requiredSolution) m.set(r.requiredSolution, (m.get(r.requiredSolution) ?? 0) + 1); }
    else for (const f of findings) for (const n of f.solutions ?? []) m.set(n, (m.get(n) ?? 0) + 1);
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [findings, missing, active]);
  const included = (name: string) => !excluded.has(name) && !(hideSystem && isSystemSolution(name));
  const categories = useMemo(() => [...new Set(findings.map((f) => categoryOf(f.rule_id)))].sort(), [findings]);

  const shown = useMemo(
    () => filterFindings(findings, { category, q, excluded, hideSystem }).sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]),
    [findings, category, q, excluded, hideSystem],
  );
  const missingShown = useMemo(
    () => missing.filter((r) => !r.requiredSolution || (!excluded.has(r.requiredSolution) && !(hideSystem && isSystemSolution(r.requiredSolution)))),
    [missing, excluded, hideSystem],
  );

  const bySev = filterFindings(shown, { severity: sev });
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of shown) counts[f.severity]++;
  const missCounts = { error: 0, warning: 0, info: 0 };
  for (const r of missingShown) missCounts[r.severity]++;
  const hidden = active === "missing" ? missing.length - missingShown.length : findings.length - shown.length;
  const filtered = active === "missing" ? Boolean(excluded.size || hideSystem) : Boolean(category || q || excluded.size || hideSystem || sev !== "all");
  const toggleSolution = (n: string) => { const x = new Set(excluded); if (x.has(n)) x.delete(n); else x.add(n); setExcluded(x); };
  const setHide = (v: boolean) => patch({ hideSystem: v });
  const clear = () => patch({ sev: "all", category: "", q: "", excluded: [], hideSystem: false });
  const includedCount = refs.filter(([n]) => included(n)).length;
  const c = active === "missing" ? missCounts : counts;

  const solutionsMenu = (
    <MenuButton ariaLabel="Filter by solutions" label={<>Solutions ({refs.length ? `${includedCount} of ${refs.length}` : "none referenced"})</>}>
      <div className="multi-pop" role="group" aria-label="Referenced solutions">
        <label className="row"><input type="checkbox" checked={hideSystem} onChange={(e) => setHide(e.target.checked)} /> <b>Hide Microsoft / system solutions</b></label>
        <p className="faint" style={{ margin: "4px 0 8px" }}>{active === "missing" ? "Rows with no known required solution" : "Findings that don't refer to another solution"} are always shown.</p>
        {refs.length > 0 && <div className="row"><button className="btn ghost sm" onClick={() => setExcluded(new Set())}>Select all</button><button className="btn ghost sm" onClick={() => setExcluded(new Set(refs.map(([n]) => n)))}>Select none</button></div>}
        <ul>{refs.map(([n, cnt]) => (
          <li key={n}><label className="row"><input type="checkbox" checked={included(n)} disabled={hideSystem && isSystemSolution(n)} onChange={() => toggleSolution(n)} /> <span className="mono">{n}</span> <span className="pill">{cnt}</span>{isSystemSolution(n) && <span className="faint"> Microsoft/system</span>}</label></li>
        ))}</ul>
        {!refs.length && <p className="muted">Nothing here refers to another solution.</p>}
      </div>
    </MenuButton>
  );

  return (<div>
    <div className="toolbar">
      <div className="seg" role="group" aria-label="Analysis view">
        <button aria-pressed={active === "missing"} className={active === "missing" ? "on" : ""} onClick={() => setView("missing")}>Missing dependencies ({missing.length}{depsLoading ? "…" : ""})</button>
        <button aria-pressed={active === "findings"} className={active === "findings" ? "on" : ""} onClick={() => setView("findings")}>All findings ({findings.length})</button>
      </div>
      <div className="summary" style={{ margin: 0 }}>
        <span className="chip error">{c.error} errors</span><span className="chip warning">{c.warning} warnings</span><span className="chip info">{c.info} info</span>
      </div>
      <span className="grow" />
      {active === "missing" && (connections.length > 0
        ? <>
            <select aria-label="Environment to check against" value={chosenConn} onChange={(e) => setConnId(e.target.value)}>{connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <button className="btn" disabled={busy || !chosenConn} onClick={() => onVerify(chosenConn)} title="Read-only check of the still-missing components against a real Dynamics 365 environment">Verify against environment</button>
          </>
        : <button className="btn ghost" onClick={onOpenEnvironments} title="Connect a Dynamics 365 environment to check missing dependencies against it">Connect an environment…</button>)}
      <button className="btn ghost" disabled={busy} onClick={onRerun} title="Re-check against everything currently loaded (e.g. after loading a parent solution)">Re-run</button>
    </div>

    {active === "missing" && (<>
      <div className="toolbar filters">{solutionsMenu}{filtered && <button className="btn ghost sm" onClick={clear}>Clear filters</button>}</div>
      {targetInfo && <div className="notice" role="status">Checked {targetInfo.checkedCount} component(s) against <b>{targetInfo.environment}</b> on {new Date(targetInfo.checkedAt).toLocaleString()}; {targetInfo.installed.length} solution(s) installed there.{targetInfo.warnings.length > 0 && <ul>{targetInfo.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}</div>}
      {hidden > 0 && <p className="muted" role="status">{hidden} row(s) hidden by the solution filter.</p>}
      <p className="muted">One row per missing dependency: what is required, which solution provides it, and what needs it. Filter any column, sort by clicking a header, and use Columns to show more detail. Rows reported by the platform come from <code>solution.xml</code>; the rest were found by scanning navigation, forms, apps, flows, roles and schema{depsLoading ? " (scanning…)" : ""}.</p>
      <ColumnTable id="missing" rows={missingShown} columns={MISSING_COLUMNS} rowKey={(r) => r.id} exportName="missing-dependencies.csv" empty={<span className="chip ok">No missing dependencies found</span>} />
    </>)}

    {active === "findings" && (<>
      <div className="toolbar filters">
        <div className="seg" role="group" aria-label="Severity filter">{(["all", "error", "warning", "info"] as const).map((v) => <button key={v} aria-pressed={sev === v} className={sev === v ? "on" : ""} onClick={() => setSev(v)}>{v}</button>)}</div>
        <input type="search" placeholder="Search findings…" aria-label="Search findings" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>{categories.map((x) => <option key={x}>{x}</option>)}
        </select>
        {solutionsMenu}
        {filtered && <button className="btn ghost sm" onClick={clear}>Clear filters</button>}
        <span className="grow" />
        <button className="btn ghost" disabled={!bySev.length} onClick={() => downloadCsv("findings.csv", [["Rule", "Category", "Severity", "Title", "Detail", "Remediation", "Referenced solutions"], ...bySev.map((f) => [f.rule_id, categoryOf(f.rule_id), f.severity, f.title, f.detail, f.remediation ?? "", (f.solutions ?? []).join("; ")])])}>Export CSV{filtered ? " (filtered)" : ""}</button>
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
    </>)}
  </div>);
}

interface DictRow { table: string; column: string; display: string; type: string; required: string; fk: string; pk: boolean; custom?: boolean; secured?: boolean; optionSet: string; maxLength: string }
const yn = (v: boolean | undefined) => (v ? "Yes" : "No");
const DICT_COLUMNS: TableColumn<DictRow>[] = [
  { key: "table", label: "Table", filter: "set", get: (r) => r.table, className: "mono" },
  { key: "column", label: "Column", filter: "text", get: (r) => r.column, render: (r) => <span className="mono">{r.column}{r.pk && " 🔑"}{r.secured && " 🔒"}</span> },
  { key: "display", label: "Display name", filter: "text", get: (r) => r.display },
  { key: "type", label: "Type", filter: "set", get: (r) => r.type },
  { key: "required", label: "Required", filter: "set", get: (r) => r.required },
  { key: "fk", label: "Lookup →", filter: "text", get: (r) => r.fk, className: "mono" },
  { key: "pk", label: "Primary key", filter: "set", defaultVisible: false, get: (r) => yn(r.pk) },
  { key: "custom", label: "Custom", filter: "set", defaultVisible: false, get: (r) => yn(r.custom) },
  { key: "secured", label: "Secured", filter: "set", defaultVisible: false, get: (r) => yn(r.secured) },
  { key: "optionSet", label: "Option set", filter: "text", defaultVisible: false, get: (r) => r.optionSet },
  { key: "maxLength", label: "Max length", filter: "text", defaultVisible: false, get: (r) => r.maxLength, sortValue: (r) => Number(r.maxLength) || 0 },
];

export function DictionaryView({ sol }: { sol: ParsedSolution }) {
  const rows = useMemo<DictRow[]>(() => (sol.entities ?? []).flatMap((e) => e.attributes.map((a) => ({
    table: e.logical, column: a.name, display: a.display, type: a.type, required: a.required, fk: (a.targets ?? []).join(", "),
    pk: !!a.pk, custom: a.custom, secured: a.secured, optionSet: a.optionSet ?? "", maxLength: a.maxLength ?? "",
  }))), [sol]);
  if (!rows.length) return <div className="panel empty">No table definitions in this package (the solution may contain only shell or non-table components).</div>;
  return <ColumnTable id="dictionary" rows={rows} columns={DICT_COLUMNS} rowKey={(r) => r.table + "." + r.column} exportName={`${sol.uniqueName}-dictionary.csv`} />;
}

const VERBS = ["create", "read", "write", "delete", "append", "appendto", "assign", "share"];
const VERB_LABEL: Record<string, string> = { create: "Create", read: "Read", write: "Write", delete: "Delete", append: "Append", appendto: "Append To", assign: "Assign", share: "Share" };
const LVL_LABEL: Record<AccessLevel, string> = { none: "—", user: "User", bu: "BU", deep: "Deep", org: "Org" };
const LVL_RANK: Record<AccessLevel, number> = { none: 0, user: 1, bu: 2, deep: 3, org: 4 };

interface PrivRow { table: string; known: boolean; pv: Record<string, AccessLevel> }
const lvlOf = (r: PrivRow, v: string): AccessLevel => (r.pv[v] ?? "none") as AccessLevel;
const PRIV_COLUMNS: TableColumn<PrivRow>[] = [
  { key: "table", label: "Table", filter: "text", get: (r) => r.table, render: (r) => <span className="mono">{r.table}{!r.known && <span className="err" title="Table is not in this solution"> ⚠</span>}</span> },
  ...VERBS.map((v): TableColumn<PrivRow> => ({ key: v, label: VERB_LABEL[v], filter: "set", get: (r) => LVL_LABEL[lvlOf(r, v)], sortValue: (r) => LVL_RANK[lvlOf(r, v)], render: (r) => <span className={`lvl ${lvlOf(r, v)}`}>{LVL_LABEL[lvlOf(r, v)]}</span> })),
];
type FieldPermRow = { entity: string; attribute: string; read: boolean; create: boolean; update: boolean };
const FIELD_COLUMNS: TableColumn<FieldPermRow>[] = [
  { key: "entity", label: "Table", filter: "set", get: (r) => r.entity, className: "mono" },
  { key: "attribute", label: "Column", filter: "text", get: (r) => r.attribute, className: "mono" },
  { key: "read", label: "Read", filter: "set", get: (r) => (r.read ? "Yes" : "No"), render: (r) => (r.read ? "✓" : "—") },
  { key: "create", label: "Create", filter: "set", get: (r) => (r.create ? "Yes" : "No"), render: (r) => (r.create ? "✓" : "—") },
  { key: "update", label: "Update", filter: "set", get: (r) => (r.update ? "Yes" : "No"), render: (r) => (r.update ? "✓" : "—") },
];

interface SecurityPrefs { mode: "roles" | "fields"; role: string; profile: string }
const normalizeSecurity = (raw: unknown): SecurityPrefs => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { mode: asOneOf(r.mode, ["roles", "fields"] as const, "roles"), role: asString(r.role), profile: asString(r.profile) };
};

export function SecurityView({ sol }: { sol: ParsedSolution }) {
  const roles = sol.roles ?? [], profiles = sol.fieldProfiles ?? [];
  const [prefs, setPrefs] = useSavedState<SecurityPrefs>("security", { mode: "roles", role: "", profile: "" }, normalizeSecurity);
  const mode = prefs.mode === "roles" && roles.length ? "roles" : prefs.mode === "fields" && profiles.length ? "fields" : roles.length ? "roles" : "fields";
  const role = roles.some((x) => x.name === prefs.role) ? prefs.role : roles[0]?.name ?? "";
  const profile = profiles.some((x) => x.name === prefs.profile) ? prefs.profile : profiles[0]?.name ?? "";
  const r = roles.find((x) => x.name === role), p = profiles.find((x) => x.name === profile);
  const privRows = useMemo<PrivRow[]>(() => {
    const ents = new Set((sol.entities ?? []).map((e) => e.logical));
    return r ? Object.entries(r.privileges).map(([table, pv]) => ({ table, known: ents.has(table) || !table.includes("_"), pv })) : [];
  }, [r, sol]);
  if (!roles.length && !profiles.length) return <div className="panel empty">No security roles or field security profiles in this package.</div>;
  return (<div>
    <div className="toolbar">
      <div className="seg" role="group" aria-label="Security view">
        {roles.length > 0 && <button aria-pressed={mode === "roles"} className={mode === "roles" ? "on" : ""} onClick={() => setPrefs((c) => ({ ...c, mode: "roles" }))}>Table privileges</button>}
        {profiles.length > 0 && <button aria-pressed={mode === "fields"} className={mode === "fields" ? "on" : ""} onClick={() => setPrefs((c) => ({ ...c, mode: "fields" }))}>Field security</button>}
      </div>
      {mode === "roles" ? <select value={role} onChange={(e) => setPrefs((c) => ({ ...c, role: e.target.value }))} aria-label="Role">{roles.map((x) => <option key={x.name}>{x.name}</option>)}</select>
        : <select value={profile} onChange={(e) => setPrefs((c) => ({ ...c, profile: e.target.value }))} aria-label="Profile">{profiles.map((x) => <option key={x.name}>{x.name}</option>)}</select>}
    </div>
    {mode === "roles" && r && <ColumnTable id="security.roles" rows={privRows} columns={PRIV_COLUMNS} rowKey={(x) => x.table} exportName={`${role}-privileges.csv`} initialSort={{ key: "table", dir: 1 }} />}
    {mode === "fields" && p && <ColumnTable id="security.fields" rows={p.permissions} columns={FIELD_COLUMNS} rowKey={(x) => x.entity + "." + x.attribute} exportName={`${profile}-field-permissions.csv`} />}
  </div>);
}

const LOG_COLUMNS: TableColumn<LogRow>[] = [
  { key: "when", label: "When", filter: "text", get: (l) => new Date(l.created_at).toLocaleString(), sortValue: (l) => l.created_at, className: "muted" },
  { key: "action", label: "Action", filter: "set", get: (l) => l.action },
  { key: "summary", label: "Summary", filter: "text", get: (l) => l.summary },
  { key: "app", label: "App", filter: "set", get: (l) => `v${l.app_version ?? ""}`, className: "muted" },
];

interface Health { version: string; encryption: boolean; allowList: boolean; tables: { table: string; ok: boolean; hint?: string }[]; config: { level: "error" | "warn"; message: string }[] }

export function LogView({ log, version, api, onPurge, onResetView }: { log: LogRow[]; version: string; api: Api; onPurge: () => void; onResetView: () => void }) {
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
      <p className="muted" style={{ marginTop: 12 }}>This browser remembers where you left off: the last page, the selected solution, filters, sort order and column layouts (per account, never sent to the server).</p>
      <button className="btn ghost" onClick={onResetView}>Reset saved view settings</button>
    </div>
    <h2>Activity</h2>
    <p className="muted">Audit trail of actions in this workspace (stored encrypted). Project release notes are in CHANGELOG.md.</p>
    <ColumnTable id="log" rows={log} columns={LOG_COLUMNS} rowKey={(l) => String(l.id)} exportName="activity.csv" initialSort={{ key: "when", dir: -1 }} empty="No activity yet." />
  </div>);
}
