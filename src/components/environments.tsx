"use client";

import { useState } from "react";
import type { Api } from "@/lib/api-client";
import { errMsg } from "@/lib/api-client";
import { validateConnectionInput } from "@/lib/d365/environment";
import { ColumnTable, type TableColumn } from "./ColumnTable";
import { Confirm } from "./ui";

export interface ConnRow { id: string; name: string; environmentUrl: string; tenantId: string; clientId: string; createdAt: string; authType?: "secret" | "certificate"; certThumbprint?: string; certExpires?: string }
interface TestOut { version?: string; canReadMetadata: boolean; canReadSolutions: boolean }

const EMPTY = { name: "", environmentUrl: "", tenantId: "", clientId: "", clientSecret: "", authType: "certificate" as "secret" | "certificate" };

const saveCertificate = (name: string, pem: string) => {
  const url = URL.createObjectURL(new Blob([pem], { type: "application/x-x509-ca-cert" }));
  const a = document.createElement("a"); a.href = url; a.download = `${name.replace(/[^A-Za-z0-9._-]+/g, "_") || "d365-solution-analyzer"}.cer`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const daysLeft = (iso?: string) => (iso ? Math.floor((Date.parse(iso) - Date.now()) / 86_400_000) : undefined);

/** Saved Dynamics 365 connections: used read-only to check missing dependencies against a real environment. */
export function EnvironmentsView({ connections, available, api, onChanged }: { connections: ConnRow[]; available: boolean; api: Api; onChanged: () => Promise<void> | void }) {
  const [form, setForm] = useState(EMPTY);
  const [err, setErr] = useState("");
  const [tests, setTests] = useState<Record<string, TestOut | string>>({});
  const [del, setDel] = useState<ConnRow | null>(null);
  const [cert, setCert] = useState<{ name: string; pem: string; thumbprint?: string } | null>(null);
  const set = (k: Exclude<keyof typeof EMPTY, "authType">) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    try { validateConnectionInput(form); } catch (x) { setErr(errMsg(x)); return; }
    try {
      const r = await api<{ connection: ConnRow; certificatePem?: string }>("/api/connections", { method: "POST", json: form });
      setForm(EMPTY); await onChanged();
      if (r.certificatePem) { setCert({ name: r.connection.name, pem: r.certificatePem, thumbprint: r.connection.certThumbprint }); saveCertificate(r.connection.name, r.certificatePem); }
    } catch (x) { setErr(errMsg(x)); }
  };
  const test = async (c: ConnRow) => {
    setTests((t) => ({ ...t, [c.id]: "" }));
    try { const r = await api<TestOut>(`/api/connections/${c.id}/test`, { method: "POST" }); setTests((t) => ({ ...t, [c.id]: r })); }
    catch (x) { setTests((t) => ({ ...t, [c.id]: errMsg(x) })); }
  };
  const downloadCert = async (c: ConnRow) => {
    try { const r = await api<{ certificatePem: string }>(`/api/connections/${c.id}/certificate`); setCert({ name: c.name, pem: r.certificatePem, thumbprint: c.certThumbprint }); saveCertificate(c.name, r.certificatePem); } catch (x) { setErr(errMsg(x)); }
  };
  const remove = async (c: ConnRow) => {
    setDel(null);
    try { await api(`/api/connections/${c.id}`, { method: "DELETE" }); await onChanged(); } catch (x) { setErr(errMsg(x)); }
  };

  const columns: TableColumn<ConnRow>[] = [
    { key: "name", label: "Name", filter: "text", get: (r) => r.name },
    { key: "url", label: "Environment", filter: "text", get: (r) => r.environmentUrl, className: "mono" },
    { key: "auth", label: "Sign-in", filter: "set", get: (r) => (r.authType === "certificate" ? "Certificate" : "Client secret") },
    { key: "certExp", label: "Certificate expires", filter: "text", get: (r) => (r.certExpires ? r.certExpires.slice(0, 10) : ""),
      render: (r) => { const d = daysLeft(r.certExpires); return r.certExpires ? <span className={d !== undefined && d < 30 ? "err" : ""}>{r.certExpires.slice(0, 10)}{d !== undefined && d < 30 ? ` (${d < 0 ? "expired" : `${d} days`})` : ""}</span> : <span className="faint">n/a</span>; } },
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
          <li>In <b>Microsoft Entra admin center &gt; App registrations</b>, create an app registration (single tenant). Copy the <i>Directory (tenant) ID</i> and <i>Application (client) ID</i>. With certificate sign-in (recommended) no secret is needed; if you choose a client secret instead, add one and copy its <i>value</i>.</li>
          <li>In the <b>Power Platform admin center &gt; Environments &gt; your environment &gt; Settings &gt; Users + permissions &gt; Application users</b>, add that app as an application user and give it a security role that can <b>read</b> what is checked (Solution, Web Resource, Process, Security Role, Model-driven App, Environment Variable Definition, Connection Reference, Plug-in Assembly, View, Form, Site Map, Chart). A read-only custom role is enough; anything it cannot read simply shows as &quot;Not checked&quot;.</li>
          <li>Paste the values below and save. For certificate sign-in the <code>.cer</code> file downloads automatically: upload it to the app registration (Certificates &amp; secrets &gt; Certificates), then press <b>Test</b>. Use a dedicated app registration for this tool; certificates last about two years (the table warns 30 days before expiry), secrets should be rotated regularly.</li>
        </ol>
      </details>
    </div>

    {connections.length > 0 && <ColumnTable id="connections" rows={connections} columns={columns} rowKey={(r) => r.id} exportName="connections.csv" actionsLabel="Actions"
      rowActions={(r) => <span className="row"><button className="btn ghost sm" onClick={() => test(r)}>Test</button>{r.authType === "certificate" && <button className="btn ghost sm" onClick={() => downloadCert(r)} title="Download the public certificate to upload to the Entra app registration">Certificate</button>}<button className="btn ghost sm" onClick={() => setDel(r)}>Delete</button></span>} />}

    <form className="panel" onSubmit={save} autoComplete="off" style={{ marginTop: 16 }}>
      <h2>Add a connection</h2>
      <div className="fields">
        <label>Name<input type="text" value={form.name} onChange={set("name")} placeholder="Production" maxLength={80} /></label>
        <label>Environment URL<input type="text" value={form.environmentUrl} onChange={set("environmentUrl")} placeholder="https://yourorg.crm.dynamics.com" inputMode="url" /></label>
        <label>Tenant ID<input type="text" value={form.tenantId} onChange={set("tenantId")} placeholder="00000000-0000-0000-0000-000000000000" /></label>
        <label>Client ID<input type="text" value={form.clientId} onChange={set("clientId")} placeholder="00000000-0000-0000-0000-000000000000" /></label>
        <label>Sign-in method<select value={form.authType} onChange={(e) => setForm((f) => ({ ...f, authType: e.target.value as "secret" | "certificate" }))}><option value="certificate">Certificate (recommended)</option><option value="secret">Client secret</option></select></label>
        {form.authType === "secret" && <label>Client secret<input type="password" value={form.clientSecret} onChange={set("clientSecret")} autoComplete="new-password" placeholder="Secret value" /></label>}
        {form.authType === "certificate" && <p className="faint" style={{ margin: 0 }}>The app creates the key pair for you. The private key stays encrypted on the server and is never shown; you only upload the public certificate (.cer) to your app registration.</p>}
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      <div className="row"><button className="btn" type="submit" disabled={!available}>Save connection</button></div>
    </form>

    {cert && (
      <div className="panel notice" role="status">
        <b>Next step for &quot;{cert.name}&quot;:</b> upload the downloaded certificate (<code>.cer</code>) in <b>Microsoft Entra admin center &gt; App registrations &gt; your app &gt; Certificates &amp; secrets &gt; Certificates &gt; Upload certificate</b>, then press <b>Test</b>.
        {cert.thumbprint && <div className="faint">SHA-1 thumbprint: <span className="mono">{cert.thumbprint}</span> (Entra shows the same value after upload)</div>}
        <div className="row"><button className="btn ghost sm" onClick={() => saveCertificate(cert.name, cert.pem)}>Download again</button><button className="btn ghost sm" onClick={() => setCert(null)}>Done</button></div>
      </div>
    )}

    {del && <Confirm title="Delete connection?" confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={() => remove(del)} body={<>This removes <b>{del.name}</b> and its encrypted secret from your workspace. It does not change the app registration or the environment.</>} />}
  </div>);
}
