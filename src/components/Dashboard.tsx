"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, errMsg, makeApi } from "@/lib/api-client";
import { buildMissingRows } from "@/lib/d365/missingDeps";
import type { ImportPlan } from "@/lib/d365/dependencies";
import { parseSolutionZip } from "@/lib/d365/parser";
import type { ParsedSolution } from "@/lib/d365/types";
import { APP_VERSION } from "@/lib/version";
import { asOneOf, asString } from "@/lib/uiStateStore";
import { ProgressProvider, useProgress, yieldToUi } from "./progress";
import { UiStateProvider, useSavedState, useUiStore } from "./uiState";
import { Confirm, ThemeCycle, Toast } from "./ui";
import { CompareApp } from "./CompareApp";
import { DependenciesView, FlowsView, NavigationView, type DepsPayload } from "./insights";
import { AnalysisView, DictionaryView, LogView, SecurityView, SolutionPicker, SolutionsView, type FindingRow, type LogRow, type SolutionRow } from "./views";

type Tab = "solutions" | "analysis" | "deps" | "navigation" | "flows" | "dictionary" | "security" | "compare" | "log";
const TABS: [Tab, string][] = [["solutions", "Solutions"], ["analysis", "Analysis"], ["deps", "Dependencies"], ["navigation", "Navigation"], ["flows", "Flows"], ["dictionary", "Data Dictionary"], ["security", "Security"], ["compare", "Compare"], ["log", "Change log"]];

const sha256 = async (buf: ArrayBuffer) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join("");

const TAB_IDS = TABS.map(([id]) => id) as readonly Tab[];

/** Everything below remembers the user's place (page, selected solution, filters, sorts, columns) in this browser, per account. */
export function Dashboard(props: { token: string; email: string; userId: string; onSignOut: () => void }) {
  return <UiStateProvider key={props.userId} userId={props.userId}><ProgressProvider><DashboardInner {...props} /></ProgressProvider></UiStateProvider>;
}

function DashboardInner({ token, email, onSignOut }: { token: string; email: string; userId: string; onSignOut: () => void }) {
  const store = useUiStore();
  const [tab, setTab] = useSavedState<Tab>("page", "solutions", (r) => asOneOf(r, TAB_IDS, "solutions"));
  const [solutions, setSolutions] = useState<SolutionRow[]>([]);
  const [unreadable, setUnreadable] = useState(0);
  const [selected, setSelectedRaw] = useSavedState<string>("selected", "", (r) => asString(r));
  const setSelected = useCallback((id: string | null) => setSelectedRaw(id ?? ""), [setSelectedRaw]);
  const [parsed, setParsed] = useState<ParsedSolution | null>(null);
  const restoredSelection = useRef(false);
  const [findings, setFindings] = useState<FindingRow[]>([]);
  const [depsState, setDepsState] = useState<{ id: string; data: DepsPayload } | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [over, setOver] = useState(false);
  const [confirmDel, setConfirmDel] = useState<SolutionRow | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const progress = useProgress();
  const api = useMemo(() => makeApi(token, (label) => progress.begin(label, { auto: true }).end), [token, progress]);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ solutions: SolutionRow[]; unreadable: number }>("/api/solutions");
      setSolutions(r.solutions); setUnreadable(r.unreadable);
      setLog((await api<{ entries: LogRow[] }>("/api/changelog")).entries);
    } catch (e) { setError(errMsg(e)); }
  }, [api]);
  useEffect(() => {
    let live = true;
    Promise.all([api<{ solutions: SolutionRow[]; unreadable: number }>("/api/solutions"), api<{ entries: LogRow[] }>("/api/changelog")])
      .then(([r, l]) => {
        if (!live) return;
        setSolutions(r.solutions); setUnreadable(r.unreadable); setLog(l.entries);
        // reopen the solution the user was last working on (if it still exists)
        const last = store.get("selected", "", (x) => asString(x));
        if (!restoredSelection.current && last) {
          restoredSelection.current = true;
          if (r.solutions.some((x) => x.id === last)) {
            api<{ solution: { parsed: ParsedSolution }; findings: FindingRow[] }>(`/api/solutions/${last}`)
              .then((d) => { if (live) { setParsed(d.solution.parsed); setFindings(d.findings); } })
              .catch(() => { if (live) { setSelectedRaw(""); } });
          } else setSelectedRaw("");
        }
      })
      .catch((e) => { if (live) setError(errMsg(e)); });
    return () => { live = false; };
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps -- runs once per session token

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : errMsg(e)); } finally { setBusy(false); }
  };

  const open = useCallback(async (id: string, goTo?: Tab) => {
    const { solution, findings } = await api<{ solution: { parsed: ParsedSolution }; findings: FindingRow[] }>(`/api/solutions/${id}`);
    setSelected(id); setParsed(solution.parsed); setFindings(findings);
    if (goTo) setTab(goTo);
  }, [api, setSelected, setTab]);

  const upload = (files: FileList | File[]) => run(() => progress.track("Loading solutions", async (h) => {
    const list = Array.from(files); let last: string | null = null;
    const at = (i: number, stage: number, detail: string) => h.set({ pct: ((i + stage) / list.length) * 90, detail: `${list[i].name} (${i + 1} of ${list.length}): ${detail}` });
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      if (!file.name.toLowerCase().endsWith(".zip")) throw new Error(`${file.name}: upload the solution .zip (not the extracted XML).`);
      at(i, 0.05, "reading the file in your browser"); await yieldToUi();
      const buf = await file.arrayBuffer();
      at(i, 0.2, "unpacking and parsing in your browser"); await yieldToUi();
      const model = await parseSolutionZip(new Uint8Array(buf)); // unpacked in the browser; the .zip itself is never uploaded
      at(i, 0.6, "encrypting and saving the parsed metadata");
      const { id } = await api<{ id: string }>("/api/solutions", { method: "POST", json: { fileName: file.name, fileSha256: await sha256(buf), parsed: model } });
      last = id;
      at(i, 1, "saved");
      setToast(`Loaded ${model.uniqueName} ${model.version}`);
    }
    h.set({ pct: 95, detail: "Refreshing the list and opening the analysis" });
    await refresh();
    if (last) await open(last, "analysis");
  }, { immediate: true }));

  const rerun = () => run(async () => {
    if (!selected) return;
    await api(`/api/solutions/${selected}`, { method: "POST" });
    await open(selected); await refresh(); setToast("Analysis refreshed");
  });
  const remove = (s: SolutionRow) => run(async () => {
    await api(`/api/solutions/${s.id}`, { method: "DELETE" });
    if (selected === s.id) { setSelected(null); setParsed(null); setFindings([]); }
    setConfirmDel(null); await refresh(); setToast("Solution deleted");
  });
  const purge = () => run(async () => {
    await api("/api/account", { method: "DELETE", headers: { "x-confirm": "delete-all-my-data" } });
    setSelected(null); setParsed(null); setFindings([]); setDepsState(null); setPlan(null); setConfirmPurge(false); store.reset();
    await refresh(); setToast("All your stored data was deleted");
  });
  const loadParsed = useCallback(async (id: string) => (await api<{ solution: { parsed: ParsedSolution } }>(`/api/solutions/${id}`)).solution.parsed, [api]);
  const logCompare = useCallback((leftId: string, rightId: string) => {
    api("/api/compare", { method: "POST", json: { leftId, rightId } }).then(refresh).catch(() => {});
  }, [api, refresh]);

  // Dependency data depends on everything loaded, so refetch when the selection or the loaded set changes.
  useEffect(() => {
    if (!selected || !(tab === "analysis" || tab === "deps" || tab === "navigation" || tab === "flows")) return;
    let live = true;
    api<DepsPayload>(`/api/solutions/${selected}/dependencies`).then((d) => live && setDepsState({ id: selected, data: d })).catch((e) => live && setError(errMsg(e)));
    if (tab === "deps") api<ImportPlan>("/api/import-plan").then((p) => live && setPlan(p)).catch(() => {});
    return () => { live = false; };
  }, [api, selected, tab, solutions.length]);

  // dependency data of the selected solution (stale data stays visible while a refresh is in flight)
  const deps = depsState && depsState.id === selected ? depsState.data : null;
  const missingRows = useMemo(() => (parsed ? buildMissingRows(parsed, deps?.resolved ?? null, deps?.loaded ?? null) : []), [parsed, deps]);
  const needsSelection = (tab === "analysis" || tab === "deps" || tab === "navigation" || tab === "flows" || tab === "dictionary" || tab === "security");

  return (
    <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); }}>
      <header id="topbar">
        <div className="brand"><span className="logo" aria-hidden="true">▦</span>D365 Solution Analyzer</div>
        <nav className="tabs" aria-label="Sections">
          {TABS.map(([id, label]) => <button key={id} aria-current={tab === id ? "page" : undefined} className={`tab${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>{label}</button>)}
        </nav>
        <div className="top-actions">
          <ThemeCycle />
          <span className="theme-name" title="Signed in as">{email}</span>
          <button className="btn ghost sm" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <main className={`page${tab === "compare" ? " wide" : ""}`}>
        {error && <div className="panel err" role="alert">{error}</div>}
        {unreadable > 0 && <div className="notice err" role="alert"><b>{unreadable} stored solution(s) cannot be decrypted</b> with the current encryption key and are hidden. If you rotated the key, add the old one to <code>DATA_ENCRYPTION_KEYS_PREVIOUS</code>; otherwise those rows are unrecoverable and can be erased with Delete all my data.</div>}

        {tab === "solutions" && (<>
          <div className={`ldrop${over ? " over" : ""}`} tabIndex={0} role="button" aria-label="Upload solution zip files"
            onClick={() => fileInput.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}>
            <b>{busy ? "Working…" : "Drop solution or patch .zip files here"}</b>
            <span className="muted">or click to choose · exported from Power Apps or <code>pac solution export</code></span>
          </div>
          <input ref={fileInput} type="file" accept=".zip" multiple hidden onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ""; }} />
          <div className="lnote"><span aria-hidden="true">🛡</span><span>The .zip is unpacked in your browser. Only parsed metadata (components, table schema, roles) is saved to your private workspace; web resource, plug-in and other file contents are never read or stored.</span></div>
          <SolutionsView solutions={solutions} selected={selected} onSelect={(id) => run(() => open(id, "analysis"))} onDelete={setConfirmDel} />
        </>)}

        {needsSelection && (
          <div className="toolbar">
            <SolutionPicker solutions={solutions} value={selected} onChange={(id) => run(() => open(id))} />
            {parsed && <span className="muted">{parsed.managed ? "Managed" : "Unmanaged"}{parsed.parentSolutionName ? ` · patch of ${parsed.parentSolutionName}` : ""}{parsed.publisher ? ` · publisher ${parsed.publisher.uniqueName} (${parsed.publisher.customizationPrefix})` : ""}</span>}
          </div>
        )}
        {needsSelection && !parsed && <div className="panel empty">Load or choose a solution to see this view.</div>}
        {tab === "analysis" && parsed && <AnalysisView key={selected} findings={findings} missing={missingRows} depsLoading={!deps} onRerun={rerun} busy={busy} />}
        {tab === "deps" && parsed && <DependenciesView sol={parsed} deps={deps} plan={plan} />}
        {tab === "navigation" && parsed && <NavigationView sol={parsed} deps={deps} />}
        {tab === "flows" && parsed && <FlowsView key={selected} sol={parsed} deps={deps} />}
        {tab === "dictionary" && parsed && <DictionaryView sol={parsed} />}
        {tab === "security" && parsed && <SecurityView key={selected} sol={parsed} />}
        {tab === "compare" && <CompareApp solutions={solutions} load={loadParsed} onLogged={logCompare} />}
        {tab === "log" && <LogView log={log} version={APP_VERSION} api={api} onPurge={() => setConfirmPurge(true)} onResetView={() => { store.reset(); window.location.reload(); }} />}
        <p className="faint" style={{ marginTop: 24 }}>D365 Solution Analyzer v{APP_VERSION} · not affiliated with or endorsed by Microsoft · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
      </main>

      {confirmDel && (
        <Confirm title="Delete solution?" confirmLabel="Delete" onCancel={() => setConfirmDel(null)} onConfirm={() => remove(confirmDel)}
          body={<>This removes <b>{confirmDel.unique_name} {confirmDel.version}</b> and its findings from your workspace. The original .zip is unaffected.</>} />
      )}
      {confirmPurge && (
        <Confirm title="Delete all your data?" confirmLabel="Delete everything" onCancel={() => setConfirmPurge(false)} onConfirm={purge}
          body={<>This permanently erases every loaded solution, finding, comparison and history entry in your workspace. Your original .zip files are not affected. This cannot be undone.</>} />
      )}
      {toast && <Toast message={toast} onDone={() => setToast("")} />}
    </div>
  );
}
