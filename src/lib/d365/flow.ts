import type { FlowNode, FlowNodeKind, ParsedFlow } from "./types";

const KIND: Record<string, FlowNodeKind> = {
  If: "condition", Switch: "switch", Foreach: "loop", Until: "loop", Scope: "scope", Workflow: "childflow",
  Http: "http", HttpWebhook: "http", ApiConnection: "connector", ApiConnectionWebhook: "connector",
  OpenApiConnection: "connector", OpenApiConnectionWebhook: "connector", OpenApiConnectionNotification: "connector",
  Compose: "data", InitializeVariable: "data", SetVariable: "data", IncrementVariable: "data", DecrementVariable: "data",
  AppendToArrayVariable: "data", AppendToStringVariable: "data", Select: "data", Query: "data", Table: "data", ParseJson: "data", Join: "data",
  Wait: "wait", Delay: "wait", DelayUntil: "wait", Terminate: "end", Response: "end", Expression: "data",
};

const lastSegment = (s: unknown) => String(s ?? "").split("/").pop() ?? "";
const literal = (v: unknown) => (typeof v === "string" && !v.startsWith("@") && !v.includes("@{") && v.length <= 80 ? v : undefined);

/**
 * Turn a cloud flow definition (Workflows/*.json in a solution) into a flat node list for visualization
 * and dependency analysis. Expressions and parameter values are deliberately not retained (they can hold secrets).
 */
export function parseFlowJson(raw: string, meta: { id: string; name: string; category: number; stateCode: number }): ParsedFlow | null {
  let doc: any;
  try { doc = JSON.parse(raw); } catch { return null; }
  const props = doc?.properties ?? doc;
  const def = props?.definition;
  if (!def || typeof def !== "object") return null;

  const nodes: FlowNode[] = [];
  const childFlows = new Set<string>();
  const refs = props.connectionReferences ?? {};
  const refLogical = (key: string): string | undefined => {
    const r = refs[key];
    return r?.connection?.connectionReferenceLogicalName ? String(r.connection.connectionReferenceLogicalName).toLowerCase() : undefined;
  };
  const used = new Set<string>();

  const describe = (name: string, a: any, id: string, parent: string | undefined, branch: string | undefined, isTrigger: boolean): FlowNode => {
    const type = String(a?.type ?? (isTrigger ? "Trigger" : "Action"));
    const host = a?.inputs?.host ?? {};
    let kind: FlowNodeKind = isTrigger ? "trigger" : KIND[type] ?? "action";
    if (!isTrigger && type === "Response") kind = "end";
    const connector = host.apiId ? lastSegment(host.apiId).replace(/^shared_/, "") : undefined;
    const operation = host.operationId ? String(host.operationId) : (a?.kind ? String(a.kind) : undefined);
    if (host.connectionName) { const l = refLogical(String(host.connectionName)); if (l) used.add(l); }
    if (type === "Workflow" && host.workflowReferenceName) childFlows.add(String(host.workflowReferenceName).toLowerCase().replace(/[{}]/g, ""));
    const entity = literal(a?.inputs?.parameters?.entityName);
    const runAfter = Object.entries(a?.runAfter ?? {}).map(([from, states]) => ({ from: `${parent ?? ""}/${from}`, states: (Array.isArray(states) ? states : []).map(String) }));
    return { id, name, type, kind, parent, branch, connector, operation, summary: [operation, entity].filter(Boolean).join(" · ") || undefined, runAfter };
  };

  const walk = (actions: any, parent: string | undefined, branch: string | undefined) => {
    for (const [name, a] of Object.entries<any>(actions ?? {})) {
      const id = `${parent ?? ""}/${name}`;
      nodes.push(describe(name, a, id, parent, branch, false));
      if (a?.type === "If") { walk(a.actions, id, "true"); walk(a.else?.actions, id, "false"); }
      else if (a?.type === "Switch") {
        for (const [cn, c] of Object.entries<any>(a.cases ?? {})) walk(c?.actions, id, cn);
        walk(a.default?.actions, id, "default");
      } else if (a?.actions) walk(a.actions, id, undefined);
    }
  };

  for (const [name, t] of Object.entries<any>(def.triggers ?? {})) nodes.push(describe(name, t, `/${name}`, undefined, undefined, true));
  walk(def.actions, undefined, undefined);

  // Environment variables appear as @parameters('Display Name (schema_name)') in solution-aware flows.
  const envVars = new Set<string>();
  const text = JSON.stringify(def);
  for (const m of text.matchAll(/parameters\(\\?'[^']*?\(([A-Za-z0-9_]+)\)\\?'\)/g)) envVars.add(m[1].toLowerCase());
  for (const k of Object.keys(refs)) { const l = refLogical(k); if (l) used.add(l); }

  return { id: meta.id, name: meta.name, category: meta.category, stateCode: meta.stateCode, nodes, connectionRefs: [...used].sort(), envVars: [...envVars].sort(), childFlows: [...childFlows].sort() };
}

/** Node ids that start a container (no runAfter), per parent+branch. */
export function childrenOf(flow: ParsedFlow, parent: string | undefined, branch?: string): FlowNode[] {
  return flow.nodes.filter((n) => n.kind !== "trigger" && n.parent === parent && (branch === undefined || n.branch === branch));
}
