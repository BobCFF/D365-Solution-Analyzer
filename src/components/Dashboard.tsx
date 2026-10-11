"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ImportPlan } from "@/lib/d365/dependencies";
import { parseSolutionZip } from "@/lib/d365/parser";
import type { ParsedSolution } from "@/lib/d365/types";
import { APP_VERSION } from "@/lib/version";
import { Confirm, ThemeCycle, Toast } from "./ui";
import { CompareApp } from "./CompareApp";
import { DependenciesView, FlowsView, NavigationView, type DepsPayload } from "./insights";
import { AnalysisView, DictionaryView, LogView, SecurityView, SolutionPicker, SolutionsView, type FindingRow, type LogRow, type SolutionRow } from "./views";

type Tab = "solutions" | "analysis" | "deps" | "navigation" | "flows" | "dictionary" | "security" | "compare" | "log";
const TABS: [Tab, string][] = [["solutions", "Solutions"], ["analysis", "Analysis"], ["deps", "Dependencies"], ["navigation", "Navigation"], ["flows", "Flows"], ["dictionary", "Data Dictionary"], ["security", "Security"], ["compare", "Compare"], ["log", "Change log"]];

const sha256 = async (buf: ArrayBuffer) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join("");

export function Dashboard({ token, email, onSignOut }: { token: string; email: string; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("solutions");
  const [solutions, setSolutions] = useState<SolutionRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSolution | null>(null);
  const [findings, setFindings] = useState<FindingRow[]>([]);
  const [deps, setDeps] = useState<DepsPayload | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [over, setOver] = useState(false);
  const [confirmDel, setConfirmDel] = useState<SolutionRow | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(path, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? res.statusText);
    return body;
  }, [token]);

  const refresh = useCallback(async () => {
    try {
      setSolutions((await api("/api/solutions")).solutions);
      setLog((await api("/api/changelog")).entries);
    } catch (e) { setError((e as Error).message); }
  }, [api]);
  useEffect(() => { refresh(); }, [refresh]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const open = useCallback(async (id: string, goTo?: Tab) => {
    const { solution, findings } = await api(`/api/solutions/${id}`);
    setSelected(id); setParsed(solution.parsed); setFindings(findings);
    if (goTo) setTab(goTo);
  }, [api]);

  const upload = (files: FileList | File[]) => run(async () => {
    let last: string | null = null;
    for (const file of Array.from(files)) {
      if (!file.name.toLowerCase().endsWith(".zip")) throw new Error(`${file.name}: upload the solution .zip (not the extracted XML).`);
      const buf = await file.arrayBuffer();
      const model = await parseSolutionZip(new Uint8Array(buf)); // unpacked in the browser; the .zip itself is never uploaded
      const { id } = await api("/api/solutions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, fileSha256: await sha256(buf), parsed: model }),
      });
      last = id;
      setToast(`Loaded ${model.uniqueName} ${model.version}`);
    }
    await refresh();
    if (last) await open(last, "analysis");
  });

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
  const loadParsed = useCallback(async (id: string) => (await api(`/api/solutions/${id}`)).solution.parsed as ParsedSolution, [api]);
  const logCompare = useCallback((leftId: string, rightId: string) => {
    api("/api/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leftId, rightId }) }).then(refresh).catch(() => {});
  }, [api, refresh]);

  // Dependency data depends on everything loaded, so refetch when the selection or the loaded set changes.
  useEffect(() => {
    if (!selected || !(tab === "deps" || tab === "navigation" || tab === "flows")) return;
    let live = true;
    setDeps(null);
    api(`/api/solutions/${selected}/dependencies`).then((d) => live && setDeps(d)).catch((e) => live && setError((e as Error).message));
    if (tab === "deps") api("/api/import-plan").then((p) => live && setPlan(p)).catch(() => {});
    return () => { live = false; };
  }, [api, selected, tab, solutions.length]);

  const needsSelection = (tab === "analysis" || tab === "deps" || tab === "navigation" || tab === "flows" || tab === "dictionary" || tab === "security");

  return (
    <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); }}>
      <header id="topbar">
        <div className="brand"><span className="logo" aria-hidden="true">▦</span>D365 Solution Analyzer</div>
        <nav className="tabs" role="tablist">
          {TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={`tab${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>{label}</button>)}
        </nav>
        <div className="top-actions">
          <ThemeCycle />
          <button className="btn ghost sm" onClick={onSignOut} title={email}>Sign out</button>
        </div>
      </header>

      <main className={`page${tab === "compare" ? " wide" : ""}`}>
        {error && <div className="panel err" role="alert">{error}</div>}

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
        {tab === "analysis" && parsed && <AnalysisView findings={findings} onRerun={rerun} busy={busy} />}
        {tab === "deps" && parsed && <DependenciesView sol={parsed} deps={deps} plan={plan} />}
        {tab === "navigation" && parsed && <NavigationView sol={parsed} deps={deps} />}
        {tab === "flows" && parsed && <FlowsView key={selected} sol={parsed} deps={deps} />}
        {tab === "dictionary" && parsed && <DictionaryView sol={parsed} />}
        {tab === "security" && parsed && <SecurityView key={selected} sol={parsed} />}
        {tab === "compare" && <CompareApp solutions={solutions} load={loadParsed} onLogged={logCompare} />}
        {tab === "log" && <LogView log={log} version={APP_VERSION} />}
        <p className="faint" style={{ marginTop: 24 }}>D365 Solution Analyzer v{APP_VERSION} · not affiliated with or endorsed by Microsoft</p>
      </main>

      {confirmDel && (
        <Confirm title="Delete solution?" confirmLabel="Delete" onCancel={() => setConfirmDel(null)} onConfirm={() => remove(confirmDel)}
          body={<>This removes <b>{confirmDel.unique_name} {confirmDel.version}</b> and its findings from your workspace. The original .zip is unaffected.</>} />
      )}
      {toast && <Toast message={toast} onDone={() => setToast("")} />}
    </div>
  );
}
