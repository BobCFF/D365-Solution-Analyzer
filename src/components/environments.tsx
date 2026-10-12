"use client";

import { useState } from "react";
import type { Api } from "@/lib/api-client";
import { errMsg } from "@/lib/api-client";
import { validateConnectionInput } from "@/lib/d365/environment";
import { ColumnTable, type TableColumn } from "./ColumnTable";
import { Confirm } from "./ui";

export interface ConnRow { id: string; name: string; environmentUrl: string; tenantId: string; clientId: string; createdAt: string }
interface TestOut { version?: string; canReadMetadata: boolean; canReadSolutions: boolean }

const EMPTY = { name: "", environmentUrl: "", tenantId: "", clientId: "", clientSecret: "" };

/** Saved Dynamics 365 connections: used read-only to check missing dependencies against a real environment. */
export function EnvironmentsView({ connections, available, api, onChanged }: { connections: ConnRow[]; available: boolean; api: Api; onChanged: () => Promise<void> | void }) {
  const [form, setForm] = useState(EMPTY);
  const [err, setErr] = useState("");
  const [tests, setTests] = useState<Record<string, TestOut | string>>({});
  const [del, setDel] = useState<ConnRow | null>(null);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    try { validateConnectionInput(form); } catch (x) { setErr(errMsg(x)); return; }
    try { await api("/api/connections", { method: "POST", json: form }); setForm(EMPTY); await onChanged(); } catch (x) { setErr(errMsg(x)); }
  };
  const test = async (c: ConnRow) => {
    setTests((t) => ({ ...t, [c.id]: "" }));
    try { const r = await api<TestOut>(`/api/connections/${c.id}/test`, { method: "POST" }); setTests((t) => ({ ...t, [c.id]: r })); }
    catch (x) { setTests((t) => ({ ...t, [c.id]: errMsg(x) })); }
  };
  const remove = async (c: ConnRow) => {
    setDel(null);
    try { await api(`/api/connections/${c.id}`, { method: "DELETE" }); await onChanged(); } catch (x) { setErr(errMsg(x)); }
  };

  const columns: TableColumn<ConnRow>[] = [
    { key: "name", label: "Name", filter: "text", get: (r) => r.name },
    { key: "url", label: "Environment", filter: "text", get: (r) => r.environmentUrl, className: "mono" },
    { key: "tenant", label: "Tenant", filter: "text", defaultVisible: false, get: (r) => r.tenantId, className: "mono" },
    { key: "client", label: "Client ID", filter: "text", defaultVisible: false, get: (r) => r.clientId, className: "mono" },
    { key: "status", label: "Last test", filter: "text", get: (r) => { const t = tests[r.id]; return t === undefined ? "Not tested" : typeof t === "string" ? t || "Testing…" : "OK"; },
      render: (r) => {
        const t = tests[r.id];
        if (t === undefined) return <span className="faint">Not tested</span>;
        if (typeof t === "string") return t ? <span className="err" role="alert">{t}</span> : <span className="muted">Testing…</span>;
        return <span><span className="chip ok">Connected</span>{t.version && <span className="muted"> v{t.version}</span>}{!t.canReadMetadata && <div className="err">Cannot read table metadata</div>}{!t.canReadSolutions && <div className="err">Cannot read solutions</div>}</span>;
      } },
  ];

  return (<div>
    <div className="panel">
      <h2>Dynamics 365 environments</h2>
      <p className="muted">Save a connection to check this app&apos;s missing dependencies against a real environment: <b>Analysis</b> then shows whether each required component, solution and version exists there. The connection is <b>read-only</b> (only GET requests), uses a Microsoft Entra app registration, and the secret is encrypted before it is stored and never shown again.</p>
      {!available && <p className="err" role="alert">Saved connections are not set up yet: run <code>supabase/migrations/20261013000000_d365_connections.sql</code> in the Supabase SQL editor.</p>}
      <details>
        <summary>How to set it up (one time, per environment)</summary>
        <ol>
          <li>In <b>Microsoft Entra admin center &gt; App registrations</b>, create an app registration (single tenant) and add a <b>client secret</b>. Copy the <i>Directory (tenant) ID</i>, <i>Application (client) ID</i> and the secret <i>value</i>.</li>
          <li>In the <b>Power Platform admin center &gt; Environments &gt; your environment &gt; Settings &gt; Users + permissions &gt; Application users</b>, add that app as an application user and give it a security role that can <b>read</b> what is checked (Solution, Web Resource, Process, Security Role, Model-driven App, Environment Variable Definition, Connection Reference, Plug-in Assembly, View, Form, Site Map, Chart). A read-only custom role is enough; anything it cannot read simply shows as &quot;Not checked&quot;.</li>
          <li>Paste the values below, save, then press <b>Test</b>. Use a dedicated app registration for this tool and rotate its secret regularly.</li>
        </ol>
      </details>
    </div>

    {connections.length > 0 && <ColumnTable id="connections" rows={connections} columns={columns} rowKey={(r) => r.id} exportName="connections.csv" actionsLabel="Actions"
      rowActions={(r) => <span className="row"><button className="btn ghost sm" onClick={() => test(r)}>Test</button><button className="btn ghost sm" onClick={() => setDel(r)}>Delete</button></span>} />}

    <form className="panel" onSubmit={save} autoComplete="off" style={{ marginTop: 16 }}>
      <h2>Add a connection</h2>
      <div className="fields">
        <label>Name<input type="text" value={form.name} onChange={set("name")} placeholder="Production" maxLength={80} /></label>
        <label>Environment URL<input type="text" value={form.environmentUrl} onChange={set("environmentUrl")} placeholder="https://yourorg.crm.dynamics.com" inputMode="url" /></label>
        <label>Tenant ID<input type="text" value={form.tenantId} onChange={set("tenantId")} placeholder="00000000-0000-0000-0000-000000000000" /></label>
        <label>Client ID<input type="text" value={form.clientId} onChange={set("clientId")} placeholder="00000000-0000-0000-0000-000000000000" /></label>
        <label>Client secret<input type="password" value={form.clientSecret} onChange={set("clientSecret")} autoComplete="new-password" placeholder="Secret value" /></label>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      <div className="row"><button className="btn" type="submit" disabled={!available}>Save connection</button></div>
    </form>

    {del && <Confirm title="Delete connection?" confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={() => remove(del)} body={<>This removes <b>{del.name}</b> and its encrypted secret from your workspace. It does not change the app registration or the environment.</>} />}
  </div>);
}
