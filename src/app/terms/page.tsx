import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms - D365 Solution Analyzer" };

export default function Terms() {
  return (
    <main className="page prose">
      <h1>Terms of use</h1>
      <p className="notice">Draft for the operator to review before offering this service to other people. Not legal advice.</p>
      <h2>Service</h2>
      <p>D365 Solution Analyzer reads Dynamics 365 / Dataverse solution exports you provide and reports on them. It never connects to or changes your Dataverse environments.</p>
      <h2>Findings are advisory</h2>
      <p>Findings, dependency checks and the suggested import order are heuristics computed from the files you load. They can be incomplete or wrong (for example, they cannot see components that exist only in the target environment). Always validate in a non-production environment, and use Microsoft&apos;s supported tools for deployment, before relying on them.</p>
      <h2>Your content</h2>
      <p>You keep all rights to your solution files and stored metadata and are responsible for having the right to analyze them. You can export or erase your data at any time.</p>
      <h2>Acceptable use</h2>
      <p>Do not attempt to access other users&apos; data, probe or overload the service, or use it unlawfully.</p>
      <h2>No warranty</h2>
      <p>The service is provided &quot;as is&quot; without warranties, and liability is limited to the extent permitted by law.</p>
      <h2>Trademarks</h2>
      <p>Not affiliated with or endorsed by Microsoft. Dynamics 365, Dataverse, Power Apps and Power Automate are trademarks of Microsoft Corporation, used here only to describe compatibility.</p>
      <p><Link href="/">Back to the app</Link></p>
    </main>
  );
}
