"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { diffRoles, LVL_RANK, VERBS, type RoleDiffRow, type RoleRowStatus, type Verb } from "@/lib/d365/roleCompare";
import type { AccessLevel, ParsedSolution } from "@/lib/d365/types";
import { errMsg } from "@/lib/api-client";
import { asString } from "@/lib/uiStateStore";
import { ColumnTable, type TableColumn } from "./ColumnTable";
import { useSavedState } from "./uiState";

const VERB_LABEL: Record<Verb, string> = { create: "Create", read: "Read", write: "Write", delete: "Delete", append: "Append", appendto: "Append To", assign: "Assign", share: "Share" };
const LVL_LABEL: Record<AccessLevel, string> = { none: "—", user: "User", bu: "BU", deep: "Deep", org: "Org" };
const STATUS_LABEL: Record<RoleRowStatus, string> = { same: "Same", different: "Different", "only-a": "Only in A", "only-b": "Only in B" };

const Lvl = ({ l }: { l: AccessLevel }) => <span className={`lvl ${l}`}>{LVL_LABEL[l]}</span>;
const cell = (r: RoleDiffRow, v: Verb) => (r.a[v] === r.b[v] ? LVL_LABEL[r.a[v]] : `${LVL_LABEL[r.a[v]]} → ${LVL_LABEL[r.b[v]]}`);

const COLUMNS: TableColumn<RoleDiffRow>[] = [
  { key: "table", label: "Table", filter: "text", get: (r) => r.table, className: "mono" },
  { key: "status", label: "Difference", filter: "set", get: (r) => STATUS_LABEL[r.status], render: (r) => <span className={`chip ${r.status === "same" ? "ok" : "warning"}`}>{STATUS_LABEL[r.status]}</span> },
  { key: "dir", label: "B vs A", filter: "set", get: (r) => (r.moreInB && r.lessInB ? "Mixed" : r.moreInB ? "B has more" : r.lessInB ? "B has less" : "Equal"), sortValue: (r) => r.moreInB - r.lessInB },
  { key: "count", label: "Verbs changed", filter: "text", defaultVisible: false, get: (r) => String(r.diffs.length), sortValue: (r) => r.diffs.length },
  ...VERBS.map((v): TableColumn<RoleDiffRow> => ({
    key: v, label: VERB_LABEL[v], filter: "set", get: (r) => cell(r, v), sortValue: (r) => LVL_RANK[r.b[v]] - LVL_RANK[r.a[v]],
    render: (r) => (r.a[v] === r.b[v] ? <Lvl l={r.a[v]} /> : <span className="rcmp-diff"><Lvl l={r.a[v]} /> → <Lvl l={r.b[v]} /></span>),
  })),
];

interface Prefs { aSol: string; aRole: string; bSol: string; bRole: string }
const normalize = (raw: unknown): Prefs => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { aSol: asString(r.aSol), aRole: asString(r.aRole), bSol: asString(r.bSol), bRole: asString(r.bRole) };
};

interface SolOption { id: string; unique_name: string; version: string }

/** Pick two security roles (from the same or different loaded solutions) and see exactly which table privileges differ. */
export function RoleCompare({ currentId, current, solutions, load }: { currentId: string; current: ParsedSolution; solutions: SolOption[]; load: (id: string) => Promise<ParsedSolution> }) {
  const [prefs, setPrefs] = useSavedState<Prefs>("security.cmp", { aSol: "", aRole: "", bSol: "", bRole: "" }, normalize);
  const known = (id: string) => solutions.some((s) => s.id === id);
  const aSol = known(prefs.aSol) ? prefs.aSol : currentId;
  const bSol = known(prefs.bSol) ? prefs.bSol : currentId;
  const [cache, setCache] = useState<Record<string, ParsedSolution>>({ [currentId]: current });
  const [err, setErr] = useState("");
  const asked = useRef(new Set<string>());

  useEffect(() => {
    for (const id of new Set([aSol, bSol])) {
      if (!id || cache[id] || asked.current.has(id)) continue;
      asked.current.add(id);
      load(id).then((p) => setCache((c) => ({ ...c, [id]: p }))).catch((e) => { asked.current.delete(id); setErr(errMsg(e)); });
    }
  }, [aSol, bSol, cache, load]);

  const rolesA = useMemo(() => cache[aSol]?.roles ?? [], [cache, aSol]);
  const rolesB = useMemo(() => cache[bSol]?.roles ?? [], [cache, bSol]);
  const roleA = rolesA.find((r) => r.name === prefs.aRole) ?? rolesA[0];
  const roleB = rolesB.find((r) => r.name === prefs.bRole) ?? (aSol === bSol && rolesB.length > 1 ? rolesB.find((r) => r !== roleA) : undefined) ?? rolesB[0];
  const diff = useMemo(() => (roleA && roleB ? diffRoles(roleA, roleB) : null), [roleA, roleB]);
  const label = (id: string) => { const s = solutions.find((x) => x.id === id); return s ? `${s.unique_name} ${s.version}` : id; };
  const set = (p: Partial<Prefs>) => setPrefs((c) => ({ ...c, ...p }));

  const side = (tag: "A" | "B", solId: string, roles: { name: string }[], role: string | undefined, onSol: (id: string) => void, onRole: (n: string) => void) => (
    <div className="rcmp-side">
      <b>{tag}</b>
      <select aria-label={`Solution ${tag}`} value={solId} onChange={(e) => onSol(e.target.value)}>{solutions.map((s) => <option key={s.id} value={s.id}>{s.unique_name} {s.version}</option>)}</select>
      <select aria-label={`Role ${tag}`} value={role ?? ""} disabled={!roles.length} onChange={(e) => onRole(e.target.value)}>{roles.length ? roles.map((r) => <option key={r.name}>{r.name}</option>) : <option value="">{cache[solId] ? "No roles in this solution" : "Loading…"}</option>}</select>
    </div>
  );

  return (<div>
    <div className="toolbar rcmp-pick">
      {side("A", aSol, rolesA, roleA?.name, (id) => set({ aSol: id, aRole: "" }), (n) => set({ aSol, aRole: n }))}
      <span className="faint" aria-hidden="true">vs</span>
      {side("B", bSol, rolesB, roleB?.name, (id) => set({ bSol: id, bRole: "" }), (n) => set({ bSol, bRole: n }))}
      <span className="grow" />
      <button className="btn ghost sm" disabled={!roleA || !roleB} onClick={() => set({ aSol: bSol, aRole: roleB?.name ?? "", bSol: aSol, bRole: roleA?.name ?? "" })} title="Swap A and B">⇄ Swap</button>
    </div>
    {err && <p className="err" role="alert">{err}</p>}
    {!diff && !err && <div className="panel empty">{rolesA.length || rolesB.length || !cache[aSol] || !cache[bSol] ? "Choose two roles to compare." : "Neither solution contains security roles."}</div>}
    {diff && roleA && roleB && (<>
      <p className="muted">Comparing <b>{roleA.name}</b> <span className="faint">({label(aSol)})</span> with <b>{roleB.name}</b> <span className="faint">({label(bSol)})</span>. A cell shows <i>A → B</i> access depth for each privilege; &quot;—&quot; means no access. Privileges are compared as exported in each solution&apos;s role definition.</p>
      <div className="summary">
        <span className="chip ok">{diff.summary.same} identical table(s)</span>
        <span className={`chip ${diff.summary.different ? "warning" : "ok"}`}>{diff.summary.different} differ</span>
        <span className={`chip ${diff.summary.onlyA ? "warning" : "ok"}`}>{diff.summary.onlyA} only in A</span>
        <span className={`chip ${diff.summary.onlyB ? "warning" : "ok"}`}>{diff.summary.onlyB} only in B</span>
        <span className="chip info">B grants more on {diff.summary.privilegesMoreInB} privilege(s), less on {diff.summary.privilegesLessInB}</span>
        <span className="chip info">Org-wide privileges: A {diff.summary.orgPrivilegesA}, B {diff.summary.orgPrivilegesB}</span>
      </div>
      {diff.summary.tables === 0 ? <div className="panel empty">Neither role grants any table privileges.</div>
        : <ColumnTable id="security.cmp" rows={diff.rows} columns={COLUMNS} rowKey={(r) => r.table} exportName={`${roleA.name}-vs-${roleB.name}.csv`} initialFilters={{ status: ["Different", "Only in A", "Only in B"] }} initialSort={{ key: "table", dir: 1 }} empty={<span className="chip ok">The two roles have identical table privileges. Use the Difference column to show identical rows too.</span>} />}
    </>)}
  </div>);
}
