"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * One busy dialog for the whole app. Every API call is tracked automatically (labelled from its path); long jobs add a
 * named task with stages and a percentage via `track`. The dialog appears after a short delay (so quick calls don't
 * flicker) and stays up briefly once shown. Tasks with `immediate` show at once (used for CPU-heavy work in the browser).
 */
export interface TaskInfo { id: number; label: string; detail?: string; pct?: number; auto: boolean; immediate: boolean }
export interface TaskUpdate { label?: string; detail?: string; pct?: number }
export interface TaskHandle { set: (p: TaskUpdate) => void; end: () => void }
interface Ctx {
  begin: (label: string, opts?: { auto?: boolean; immediate?: boolean }) => TaskHandle;
  track: <T>(label: string, fn: (h: TaskHandle) => Promise<T>, opts?: { immediate?: boolean }) => Promise<T>;
}

const SHOW_AFTER_MS = 200;
const MIN_SHOWN_MS = 500;
const ProgressCtx = createContext<Ctx | null>(null);

export function useProgress(): Ctx {
  const c = useContext(ProgressCtx);
  if (!c) throw new Error("ProgressProvider is missing");
  return c;
}

/** Let the browser paint (so the dialog is visible) before a long synchronous job starts. */
export const yieldToUi = () => new Promise<void>((r) => { if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(r, 0)); else setTimeout(r, 0); });

export function ProgressProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const next = useRef(1);
  const begin = useCallback<Ctx["begin"]>((label, opts = {}) => {
    const id = next.current++;
    setTasks((t) => [...t, { id, label, auto: !!opts.auto, immediate: !!opts.immediate }]);
    let ended = false;
    return {
      set: (p) => { if (!ended) setTasks((t) => t.map((x) => (x.id === id ? { ...x, ...p, pct: p.pct === undefined ? x.pct : Math.max(0, Math.min(100, p.pct)) } : x))); },
      end: () => { if (ended) return; ended = true; setTasks((t) => t.filter((x) => x.id !== id)); },
    };
  }, []);
  const track = useCallback<Ctx["track"]>(async (label, fn, opts) => {
    const h = begin(label, opts);
    try { return await fn(h); } finally { h.end(); }
  }, [begin]);
  const ctx = useMemo(() => ({ begin, track }), [begin, track]);
  return <ProgressCtx.Provider value={ctx}>{children}<ProgressDialog tasks={tasks} /></ProgressCtx.Provider>;
}

function ProgressDialog({ tasks }: { tasks: TaskInfo[] }) {
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);
  const active = tasks.length > 0;
  const urgent = tasks.some((t) => t.immediate);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (active && !shown) timer = setTimeout(() => { shownAt.current = Date.now(); setShown(true); }, urgent ? 0 : SHOW_AFTER_MS);
    else if (!active && shown) timer = setTimeout(() => setShown(false), Math.max(0, MIN_SHOWN_MS - (Date.now() - shownAt.current)));
    return () => clearTimeout(timer);
  }, [active, shown, urgent]);
  if (!shown) return null;
  // named tasks win over the generic per-request ones, which are only listed when nothing else is running
  const named = tasks.filter((t) => !t.auto);
  const list = named.length ? named : tasks;
  return <ProgressShell primary={list[0]} others={list.slice(1)} />;
}

function ProgressShell({ primary, others }: { primary?: TaskInfo; others: TaskInfo[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current, opener = document.activeElement as HTMLElement | null;
    if (d && !d.open) d.showModal();
    return () => { d?.close(); opener?.focus?.(); };
  }, []);
  const pct = primary?.pct;
  return (
    <dialog ref={ref} className="modal prog" aria-labelledby="prog-title" aria-busy="true" onCancel={(e) => e.preventDefault()}>
      <h2 id="prog-title" role="status">{primary ? primary.label : "Finishing…"}<span aria-hidden="true">…</span></h2>
      <div className={`prog-bar${pct === undefined ? " indet" : ""}`} role="progressbar" aria-labelledby="prog-title" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct === undefined ? undefined : Math.round(pct)}>
        <div style={pct === undefined ? undefined : { width: `${pct}%` }} />
      </div>
      {primary?.detail && <p className="muted prog-detail">{primary.detail}</p>}
      {others.length > 0 && <ul className="muted prog-others">{others.map((t) => <li key={t.id}>{t.label}</li>)}</ul>}
      <p className="faint prog-note">Please wait. This closes by itself.</p>
    </dialog>
  );
}
