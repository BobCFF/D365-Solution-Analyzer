"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

/** Native <dialog>: focus is trapped, Esc closes, and focus returns to the opener (Salesforce Analyzer U2/EA1). */
export function Confirm({ title, body, confirmLabel, onConfirm, onCancel }: {
  title: string; body: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current, opener = document.activeElement as HTMLElement | null;
    d?.showModal();
    return () => { d?.close(); opener?.focus?.(); };
  }, []);
  return (
    <dialog ref={ref} className="modal" aria-labelledby="dlg-title" onCancel={(e) => { e.preventDefault(); onCancel(); }} onClick={(e) => e.target === ref.current && onCancel()}>
      <h2 id="dlg-title">{title}</h2><div className="muted">{body}</div>
      <div className="actions">
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn danger" autoFocus onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </dialog>
  );
}

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, [message, onDone]);
  return <div className="toast" role="status">{message}</div>;
}

export const THEMES = [
  { id: "system", label: "System" }, { id: "light", label: "Light" }, { id: "dark", label: "Dark" },
  { id: "contrast", label: "High contrast" }, { id: "mono", label: "Monochrome" },
] as const;
const THEME_KEY = "d365-sa-theme";

export function applyTheme(id: string) {
  const el = document.documentElement;
  if (id === "system") el.removeAttribute("data-theme"); else el.setAttribute("data-theme", id);
}
function readTheme(): string {
  try { return localStorage.getItem(THEME_KEY) ?? "system"; } catch { return "system"; }
}
const themeListeners = new Set<() => void>();
const subscribeTheme = (cb: () => void) => { themeListeners.add(cb); return () => { themeListeners.delete(cb); }; };

export function ThemeCycle() {
  // External store (localStorage + DOM attribute): no setState-in-effect, and no hydration mismatch.
  const id = useSyncExternalStore(subscribeTheme, readTheme, () => "system");
  useEffect(() => { applyTheme(id); }, [id]);
  const next = () => {
    const n = THEMES[(THEMES.findIndex((t) => t.id === id) + 1) % THEMES.length].id;
    try { localStorage.setItem(THEME_KEY, n); } catch { /* storage unavailable: theme still applies for this page view */ }
    applyTheme(n);
    themeListeners.forEach((cb) => cb());
  };
  return (<>
    <span className="theme-name" aria-hidden="true">{THEMES.find((t) => t.id === id)?.label}</span>
    <button className="btn ghost sm" onClick={next} aria-label={`Cycle theme (current: ${THEMES.find((t) => t.id === id)?.label})`}>Theme</button>
  </>);
}

/** Disclosure popover (<details>) that closes on an outside click, on Esc, and when another menu is opened. */
export function MenuButton({ label, ariaLabel, small, children }: { label: ReactNode; ariaLabel: string; small?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => { const d = ref.current; if (d?.open && !d.contains(e.target as Node)) d.open = false; };
    const esc = (e: KeyboardEvent) => { const d = ref.current; if (e.key === "Escape" && d?.open) { d.open = false; (d.querySelector("summary") as HTMLElement | null)?.focus(); } };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, []);
  return (
    <details className="multi" ref={ref}>
      <summary className={`btn ghost${small ? " sm" : ""}`} aria-label={ariaLabel}>{label}</summary>
      {children}
    </details>
  );
}

/** RFC 4180 CSV with spreadsheet-formula neutralisation (cells starting = + - @ are prefixed). */
export function toCsv(rows: (string | number | boolean | undefined)[][]): string {
  const cell = (v: string | number | boolean | undefined) => {
    let s = v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
export function downloadCsv(name: string, rows: (string | number | boolean | undefined)[][]) {
  const url = URL.createObjectURL(new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const SEV_ORDER = { error: 0, warning: 1, info: 2 } as const;
