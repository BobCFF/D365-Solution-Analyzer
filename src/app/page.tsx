"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { browserClient, supabaseConfigured } from "@/lib/supabase";
import type { SolutionComparison } from "@/lib/d365/compare";

interface SolutionRow { id: string; unique_name: string; friendly_name: string; version: string; managed: boolean; parent_solution_name: string | null; file_name: string; created_at: string }
interface FindingRow { id: number; rule_id: string; severity: "error" | "warning" | "info"; title: string; detail: string; remediation: string | null }
interface LogRow { id: number; action: string; summary: string; app_version: string | null; created_at: string }

export default function Home() {
  if (!supabaseConfigured) {
    return <main><h1>D365 Solution Analyzer</h1><p className="err">Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).</p></main>;
  }
  return <App />;
}

function App() {
  const [db] = useState(() => browserClient());
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    db.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = db.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [db]);

  if (!ready) return <main />;
  if (!session) return <Login onLogin={(email, pw, signUp) => signUp ? db.auth.signUp({ email, password: pw }) : db.auth.signInWithPassword({ email, password: pw })} />;
  return <Dashboard token={session.access_token} email={session.user.email ?? ""} onSignOut={() => db.auth.signOut()} />;
}

function Login({ onLogin }: { onLogin: (e: string, p: string, signUp: boolean) => PromiseLike<{ error: { message: string } | null }> }) {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [msg, setMsg] = useState("");
  const go = async (signUp: boolean) => { const { error } = await onLogin(email, pw, signUp); setMsg(error?.message ?? (signUp ? "Check your email to confirm, then sign in." : "")); };
  return (
    <main>
      <h1>D365 Solution Analyzer</h1><p className="muted">Sign in to load and analyze solutions.</p>
      <div className="row">
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="Password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <button onClick={() => go(false)}>Sign in</button><button className="ghost" onClick={() => go(true)}>Sign up</button>
      </div>
      {msg && <p className="err">{msg}</p>}
    </main>
  );
}

function Dashboard({ token, email, onSignOut }: { token: string; email: string; onSignOut: () => void }) {
  const [solutions, setSolutions] = useState<SolutionRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [findings, setFindings] = useState<FindingRow[]>([]);
  const [cmp, setCmp] = useState<{ l: string; r: string }>({ l: "", r: "" });
  const [diff, setDiff] = useState<SolutionComparison | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(path, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } });
    const body = await res.json();
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

  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(""); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };

  const open = (id: string) => run(async () => { setSelected(id); setFindings((await api(`/api/solutions/${id}`)).findings); });
  const upload = (file: File) => run(async () => {
    const fd = new FormData(); fd.append("file", file);
    const { id } = await api("/api/solutions", { method: "POST", body: fd });
    await refresh(); await open(id);
  });
  const reanalyze = (id: string) => run(async () => { await api(`/api/solutions/${id}`, { method: "POST" }); await open(id); await refresh(); });
  const remove = (id: string) => run(async () => { await api(`/api/solutions/${id}`, { method: "DELETE" }); if (selected === id) { setSelected(null); setFindings([]); } await refresh(); });
  const compare = () => run(async () => setDiff((await api("/api/compare", { method: "POST", body: JSON.stringify({ leftId: cmp.l, rightId: cmp.r }) })).result));

  const label = (s: SolutionRow) => `${s.unique_name} ${s.version} (${s.managed ? "managed" : "unmanaged"}${s.parent_solution_name ? ", patch" : ""})`;

  return (
    <main>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div><h1>D365 Solution Analyzer</h1><span className="muted">{email}</span></div>
        <button className="ghost" onClick={onSignOut}>Sign out</button>
      </div>
      {error && <p className="err">{error}</p>}

      <h2>Load solution or patch</h2>
      <input type="file" accept=".zip" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <p className="muted">Export from Power Apps / Dataverse (or <code>pac solution export</code>). Max 4 MB per upload.</p>

      <h2>Loaded solutions</h2>
      <table><thead><tr><th>Solution</th><th>Version</th><th>Type</th><th /></tr></thead><tbody>
        {solutions.map((s) => (
          <tr key={s.id}><td>{s.friendly_name}<div className="muted">{s.unique_name}</div></td><td>{s.version}</td>
            <td>{s.managed ? "Managed" : "Unmanaged"}{s.parent_solution_name ? ` patch of ${s.parent_solution_name}` : ""}</td>
            <td className="row"><button onClick={() => open(s.id)}>Analyze</button><button className="ghost" onClick={() => remove(s.id)}>Delete</button></td></tr>
        ))}
        {!solutions.length && <tr><td colSpan={4} className="muted">Nothing loaded yet.</td></tr>}
      </tbody></table>

      {selected && (<>
        <h2>Findings <button className="ghost" onClick={() => reanalyze(selected)}>Re-run</button></h2>
        {!findings.length && <p>No issues found.</p>}
        {findings.map((f) => (
          <div className="card" key={f.id}><span className={`sev ${f.severity}`}>{f.severity}</span> <b>{f.title}</b> <span className="muted">{f.rule_id}</span>
            <div>{f.detail}</div>{f.remediation && <div className="muted">Fix: {f.remediation}</div>}</div>
        ))}
      </>)}

      <h2>Compare</h2>
      <div className="row">
        {(["l", "r"] as const).map((k) => (
          <select key={k} value={cmp[k]} onChange={(e) => setCmp({ ...cmp, [k]: e.target.value })}>
            <option value="">{k === "l" ? "Base…" : "Target…"}</option>{solutions.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}
          </select>
        ))}
        <button disabled={!cmp.l || !cmp.r || busy} onClick={compare}>Compare</button>
      </div>
      {diff && <DiffView d={diff} />}

      <h2>Change log</h2>
      <table><tbody>{log.map((l) => (
        <tr key={l.id}><td className="muted">{new Date(l.created_at).toLocaleString()}</td><td>{l.action}</td><td>{l.summary}</td><td className="muted">v{l.app_version}</td></tr>
      ))}</tbody></table>
    </main>
  );
}

function DiffView({ d }: { d: SolutionComparison }) {
  const sec = (title: string, items: { typeName: string; key: string; displayName?: string; changes?: string[] }[]) => items.length > 0 && (
    <div className="card"><b>{title} ({items.length})</b><ul>{items.map((i) => <li key={i.typeName + i.key}>{i.typeName}: {i.displayName || i.key}{i.changes && <ul>{i.changes.map((c) => <li key={c}>{c}</li>)}</ul>}</li>)}</ul></div>
  );
  return (<div>
    <p className="muted">{d.left.uniqueName} {d.left.version} → {d.right.uniqueName} {d.right.version} · {d.unchangedCount} unchanged</p>
    {d.metadata.length > 0 && <div className="card"><b>Metadata</b><ul>{d.metadata.map((m) => <li key={m.field}>{m.field}: {m.left || "-"} → {m.right || "-"}</li>)}</ul></div>}
    {sec("Added", d.added)}{sec("Removed", d.removed)}{sec("Changed", d.changed)}
  </div>);
}
