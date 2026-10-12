"use client";

import { useMemo } from "react";
import { componentTypeName } from "@/lib/d365/componentTypes";
import type { DepStatus, ImportPlan, ResolvedRef } from "@/lib/d365/dependencies";
import type { ParsedSolution } from "@/lib/d365/types";
import { FlowDiagram } from "./FlowDiagram";
import { ColumnTable, type TableColumn } from "./ColumnTable";
import { useSavedState } from "./uiState";

export interface DepsPayload { resolved: ResolvedRef[]; counts: Record<string, number>; truncated: boolean; loaded?: string[] }

const STATUS_TEXT: Record<DepStatus, string> = {
  missing: "Missing", other: "In another solution", internal: "In this solution", platform: "Platform (assumed)", unverifiable: "Verify in target",
};
const STATUS_CLASS: Record<DepStatus, string> = { missing: "error", other: "ok", internal: "ok", platform: "info", unverifiable: "warning" };

export function StatusChip({ s }: { s: DepStatus }) { return <span className={`chip ${STATUS_CLASS[s]}`}>{STATUS_TEXT[s]}</span>; }

/* ---------------- Dependencies ---------------- */
const DEP_COLUMNS: TableColumn<ResolvedRef>[] = [
  { key: "fromType", label: "Component type", filter: "set", defaultVisible: false, get: (r) => componentTypeName(r.ref.from.type) },
  { key: "from", label: "Component", filter: "text", get: (r) => `${componentTypeName(r.ref.from.type)} ${r.ref.from.name ?? r.ref.from.key}`, render: (r) => <><span className="muted">{componentTypeName(r.ref.from.type)}</span> <span className="mono">{r.ref.from.name ?? r.ref.from.key}</span></> },
  { key: "relation", label: "Relationship", filter: "set", get: (r) => r.ref.kind, className: "muted" },
  { key: "toType", label: "Requires (type)", filter: "set", defaultVisible: false, get: (r) => componentTypeName(r.ref.to.type) },
  { key: "to", label: "Requires", filter: "text", get: (r) => `${componentTypeName(r.ref.to.type)} ${r.ref.to.key}`, render: (r) => <><span className="muted">{componentTypeName(r.ref.to.type)}</span> <span className="mono">{r.ref.to.key}</span></> },
  { key: "status", label: "Status", filter: "set", get: (r) => STATUS_TEXT[r.status], sortValue: (r) => order(r.status), render: (r) => <StatusChip s={r.status} /> },
  { key: "providedBy", label: "Provided by", filter: "set", get: (r) => r.providedBy ?? "" },
  { key: "where", label: "Where", filter: "text", defaultVisible: false, get: (r) => r.ref.detail ?? "" },
];

export function DependenciesView({ sol, deps, plan }: { sol: ParsedSolution; deps: DepsPayload | null; plan: ImportPlan | null }) {
  if (!deps) return <div className="panel empty">Loading dependencies…</div>;
  const c = deps.counts;
  return (<div>
    <p className="muted">Every reference found in <b>{sol.uniqueName}</b> (navigation, apps, forms, flows, web resources, schema) is checked against this solution and everything else you have loaded. Only components that are clearly custom and absent are flagged <i>Missing</i>; platform components are assumed present. The table starts filtered to what needs attention; use the ⋯ menu on the <b>Status</b> column to see everything.</p>
    <div className="summary">
      <span className="chip error">{c.missing ?? 0} missing</span><span className="chip warning">{c.unverifiable ?? 0} to verify</span>
      <span className="chip ok">{c.other ?? 0} in other solutions</span><span className="chip ok">{c.internal ?? 0} satisfied here</span><span className="chip info">{c.platform ?? 0} platform</span>
    </div>
    <ColumnTable id="deps" rows={deps.resolved} columns={DEP_COLUMNS} rowKey={(r) => `${r.ref.from.type}:${r.ref.from.key}|${r.ref.kind}|${r.ref.to.type}:${r.ref.to.key}|${r.ref.detail ?? ""}`} exportName={`${sol.uniqueName}-dependencies.csv`}
      initialFilters={{ status: [STATUS_TEXT.missing, STATUS_TEXT.unverifiable] }} initialSort={{ key: "status", dir: 1 }} empty="No dependencies found." />
    {deps.truncated && <p className="muted">Showing the first 5,000 references.</p>}

    <h2 style={{ marginTop: 24 }}>Suggested import order (all loaded solutions)</h2>
    {!plan ? <p className="muted">Loading…</p> : (<>
      <ol className="plan">{plan.order.map((o) => <li key={o.solution}><b>{o.solution}</b> <span className="mono muted">{o.version}</span>{o.after.length > 0 && <span className="muted"> - after {o.after.join(", ")}</span>}</li>)}</ol>
      {plan.cycles.length > 0 && <div className="notice err">Circular dependency between: {plan.cycles[0].join(", ")}. Move the shared components into a common base solution.</div>}
    </>)}
  </div>);
}
const order = (s: DepStatus) => ({ missing: 0, unverifiable: 1, other: 2, internal: 3, platform: 4 })[s];

/* ---------------- Navigation ---------------- */
export function NavigationView({ sol, deps }: { sol: ParsedSolution; deps: DepsPayload | null }) {
  const maps = sol.siteMaps ?? [], apps = sol.apps ?? [];
  const issues = useMemo(() => {
    const m = new Map<string, ResolvedRef[]>();
    for (const r of deps?.resolved ?? []) if (r.status === "missing" || r.status === "unverifiable") (m.get(r.ref.from.key) ?? m.set(r.ref.from.key, []).get(r.ref.from.key)!).push(r);
    return m;
  }, [deps]);
  if (!maps.length && !apps.length) return <div className="panel empty">No site maps or model-driven apps in this package.</div>;
  const badge = (key: string) => {
    if (!deps) return null;
    const rs = issues.get(key) ?? [];
    const miss = rs.filter((r) => r.status === "missing");
    if (miss.length) return <span className="chip error" title={miss.map((r) => r.ref.to.key).join(", ")}>✗ missing {miss.map((r) => r.ref.to.key).slice(0, 2).join(", ")}</span>;
    if (rs.length) return <span className="chip warning">verify</span>;
    return <span className="chip ok">✓</span>;
  };
  return (<div>
    <p className="muted">Navigation is a common cause of failed imports and blank apps: each item points at a table, web resource or dashboard that must exist in the target. ✗ marks items whose target is missing.</p>
    {maps.map((sm, mi) => {
      const rootKey = sm.id || sm.name;
      return (
        <div className="panel" key={mi}><h2>Site map: {sm.name}</h2>
          {sm.areas.map((a) => (
            <div key={a.id} className="nav-area"><div className="nav-title">{a.title} <span className="faint mono">{a.id}</span> {badge(`${rootKey}/${a.id}`)}</div>
              {a.groups.map((g) => (
                <div key={g.id} className="nav-group"><div className="muted">{g.title}</div>
                  <ul>{g.subAreas.map((s) => (
                    <li key={s.id}>{s.title} <span className="faint mono">{s.entity ?? s.url ?? (s.dashboard ? "dashboard" : "no target")}</span> {badge(`${rootKey}/${a.id}/${g.id}/${s.id}`)}</li>
                  ))}</ul></div>
              ))}
            </div>
          ))}
        </div>
      );
    })}
    {apps.length > 0 && (
      <div className="panel"><h2>Model-driven apps</h2>
        {apps.map((a) => (
          <div key={a.uniqueName} className="nav-area"><div className="nav-title">{a.name} <span className="faint mono">{a.uniqueName}</span> {badge(a.uniqueName)}</div>
            <div className="muted">{a.components.length} component(s): {countTypes(a.components)}{a.roles.length ? `; ${a.roles.length} role(s)` : ""}</div>
            {(issues.get(a.uniqueName) ?? []).filter((r) => r.status === "missing").map((r, i) => <div key={i} className="err">✗ {componentTypeName(r.ref.to.type)} <span className="mono">{r.ref.to.key}</span> is not in the solution or any loaded solution</div>)}
          </div>
        ))}
      </div>
    )}
  </div>);
}
const countTypes = (c: { type: number }[]) => Object.entries(c.reduce<Record<number, number>>((m, x) => ((m[x.type] = (m[x.type] ?? 0) + 1), m), {})).map(([t, n]) => `${n} ${componentTypeName(Number(t))}`).join(", ");

/* ---------------- Flows ---------------- */
export function FlowsView({ sol, deps }: { sol: ParsedSolution; deps: DepsPayload | null }) {
  const flows = sol.flows ?? [];
  const [id, setId] = useSavedState<string>("flows.selected", "", (r) => (typeof r === "string" ? r : ""));
  const flow = flows.find((f) => f.id === id) ?? flows[0];
  if (!flows.length) return <div className="panel empty">No cloud flow definitions in this package. Flows are read from <code>Workflows/*.json</code>; export the solution with its flows included.</div>;
  const problems = (deps?.resolved ?? []).filter((r) => r.ref.from.type === 29 && r.ref.from.key === flow.id && r.status === "missing");
  return (<div>
    <div className="toolbar">
      <select value={flow.id} onChange={(e) => setId(e.target.value)} aria-label="Flow">{flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
      <span className="muted">{flow.nodes.length} steps · {flow.stateCode === 1 ? "On" : flow.stateCode === 0 ? "Off" : "state unknown"}</span>
    </div>
    <div className="summary">
      {flow.connectionRefs.map((c) => <span key={c} className="chip info" title="Connection reference">🔌 {c}</span>)}
      {flow.envVars.map((c) => <span key={c} className="chip info" title="Environment variable">⚙ {c}</span>)}
      {flow.childFlows.map((c) => <span key={c} className="chip info" title="Child flow">⤵ {c.slice(0, 8)}…</span>)}
    </div>
    {problems.map((r, i) => <div key={i} className="notice err">✗ Requires {componentTypeName(r.ref.to.type)} <span className="mono">{r.ref.to.key}</span>, which is not in the solution or any loaded solution.</div>)}
    <FlowDiagram key={flow.id} flow={flow} />
  </div>);
}
