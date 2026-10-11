import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy - D365 Solution Analyzer" };

/** Public privacy summary (mirrors PRIVACY.md and docs/SECURITY.md). DRAFT until the operator completes the details below. */
export default function Privacy() {
  return (
    <main className="page prose">
      <h1>Privacy</h1>
      <p className="notice">Draft for the operator to review and complete (operator name, contact address, jurisdiction) before offering this service to other people. Not legal advice.</p>
      <h2>What happens to your solution files</h2>
      <p>The .zip is unpacked <b>in your browser</b> and is never uploaded. Web resources, plug-in assemblies, canvas app packages and other file contents are not read or stored, and flow expressions and parameter values are discarded.</p>
      <h2>What is stored</h2>
      <p>Solution names and versions, publisher, component lists, table and column schema, security role and field-profile summaries, navigation trees, cloud flow structure (step names, types, connector and operation names), analysis findings, comparison results and an audit log of your actions. Customer <i>data</i> is not part of a solution file.</p>
      <p>All of this is <b>encrypted by the application (AES-256-GCM, per-user keys) before it is written to the database</b>; database administrators and backups see only ciphertext. Not encrypted: identifiers, timestamps, rule ids and severities, and audit action types.</p>
      <h2>Your controls</h2>
      <p>Delete a single solution, download everything we hold as JSON, or erase your whole workspace at any time (Change log tab). Signing out ends your session.</p>
      <h2>Processors (subprocessors)</h2>
      <ul><li><b>Supabase</b>: database and authentication (stores encrypted data, your email address and sign-in records).</li><li><b>Vercel</b>: hosting (standard request logs: IP address, timestamp, path).</li></ul>
      <h2>Cookies and tracking</h2>
      <p>No analytics or advertising. Your sign-in session and theme preference are kept in your browser&apos;s local storage.</p>
      <p><Link href="/">Back to the app</Link></p>
    </main>
  );
}
