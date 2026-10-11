"use client";

import { useEffect, useState, type ReactNode } from "react";

export function Confirm({ title, body, confirmLabel, onConfirm, onCancel }: {
  title: string; body: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCancel]);
  return (
    <div className="scrim" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2><div className="muted">{body}</div>
        <div className="actions">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn danger" autoFocus onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
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
export function savedTheme(): string {
  try { return localStorage.getItem(THEME_KEY) ?? "system"; } catch { return "system"; }
}
export function ThemeCycle() {
  const [id, setId] = useState("system");
  useEffect(() => { const t = savedTheme(); setId(t); applyTheme(t); }, []);
  const next = () => {
    const n = THEMES[(THEMES.findIndex((t) => t.id === id) + 1) % THEMES.length].id;
    setId(n); applyTheme(n);
    try { localStorage.setItem(THEME_KEY, n); } catch { /* storage unavailable */ }
  };
  return (<>
    <span className="theme-name" aria-hidden="true">{THEMES.find((t) => t.id === id)?.label}</span>
    <button className="btn ghost sm" onClick={next} aria-label="Cycle theme">Theme</button>
  </>);
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
