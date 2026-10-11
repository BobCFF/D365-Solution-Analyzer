import type { FlowNode, ParsedFlow } from "./types";

export interface Box { x: number; y: number; w: number; h: number }
export interface LaidNode extends Box { node: FlowNode; container: boolean }
export interface LaidEdge { from: string; to: string; states: string[]; fault: boolean }
export interface Lane extends Box { label: string; owner: string }
export interface FlowLayout { nodes: Map<string, LaidNode>; edges: LaidEdge[]; lanes: Lane[]; width: number; height: number }

const NODE_W = 210, NODE_H = 54, GAP_X = 28, GAP_Y = 36, PAD = 14, HEAD = 40, LANE_HEAD = 22;
const CONTAINERS = new Set(["condition", "switch", "loop", "scope"]);

/**
 * Nested top-down layout. Within a block, actions are layered by runAfter (parallel branches sit side by side);
 * containers (If / Switch / Foreach / Scope) enclose their own blocks, with If/Switch branches as lanes.
 */
export function layoutFlow(flow: ParsedFlow): FlowLayout {
  const nodes = new Map<string, LaidNode>();
  const edges: LaidEdge[] = [];
  const lanes: Lane[] = [];
  const kids = new Map<string, FlowNode[]>();
  for (const n of flow.nodes) { const k = `${n.parent ?? ""}|${n.kind === "trigger" ? "t" : ""}`; (kids.get(k) ?? kids.set(k, []).get(k)!).push(n); }
  const branchesOf = (id: string): string[] => {
    const set: string[] = [];
    for (const n of flow.nodes) if (n.parent === id) { const b = n.branch ?? ""; if (!set.includes(b)) set.push(b); }
    const rank = (b: string) => (b === "true" ? 0 : b === "false" ? 2 : b === "default" ? 3 : 1);
    return set.sort((a, b) => rank(a) - rank(b));
  };

  interface Placed { id: string; dx: number; dy: number; w: number; h: number }
  // Returns the block's size and its items positioned relative to the block origin.
  function block(items: FlowNode[]): { w: number; h: number; placed: Placed[]; lanesRel: (Lane & { rel: true })[]; edgesOut: LaidEdge[] } {
    const ids = new Set(items.map((n) => n.id));
    const level = new Map<string, number>();
    const lv = (n: FlowNode, seen = new Set<string>()): number => {
      if (level.has(n.id)) return level.get(n.id)!;
      if (seen.has(n.id)) return 0;
      seen.add(n.id);
      let l = 0;
      for (const r of n.runAfter) { const p = items.find((x) => x.id === r.from); if (p) l = Math.max(l, lv(p, seen) + 1); }
      level.set(n.id, l);
      return l;
    };
    items.forEach((n) => lv(n));
    const rows: FlowNode[][] = [];
    for (const n of items) (rows[level.get(n.id)!] ??= []).push(n);

    const sizes = new Map<string, { w: number; h: number; inner?: ReturnType<typeof innerOf> }>();
    function innerOf(n: FlowNode) {
      const bs = branchesOf(n.id);
      const parts = bs.map((b) => ({ branch: b, blk: block(flow.nodes.filter((x) => x.parent === n.id && (x.branch ?? "") === b)) }));
      const showLabel = n.kind === "condition" || n.kind === "switch";
      const w = Math.max(NODE_W, parts.reduce((s, p) => s + Math.max(NODE_W, p.blk.w), 0) + GAP_X * Math.max(0, parts.length - 1)) + PAD * 2;
      const h = HEAD + (showLabel ? LANE_HEAD : 0) + Math.max(0, ...parts.map((p) => p.blk.h)) + PAD;
      return { parts, showLabel, w, h };
    }
    for (const n of items) {
      if (CONTAINERS.has(n.kind) && flow.nodes.some((x) => x.parent === n.id)) { const inner = innerOf(n); sizes.set(n.id, { w: inner.w, h: inner.h, inner }); }
      else sizes.set(n.id, { w: NODE_W, h: NODE_H });
    }
    const rowW = rows.map((r) => (r ?? []).reduce((s, n) => s + sizes.get(n.id)!.w, 0) + GAP_X * Math.max(0, (r ?? []).length - 1));
    const w = Math.max(NODE_W, ...rowW);
    let y = 0;
    const placed: Placed[] = [];
    const lanesRel: (Lane & { rel: true })[] = [];
    const edgesOut: LaidEdge[] = [];
    rows.forEach((r, ri) => {
      if (!r) return;
      const rh = Math.max(...r.map((n) => sizes.get(n.id)!.h));
      let x = (w - rowW[ri]) / 2;
      for (const n of r) {
        const sz = sizes.get(n.id)!;
        placed.push({ id: n.id, dx: x, dy: y, w: sz.w, h: sz.h });
        if (sz.inner) {
          let lx = x + PAD;
          for (const p of sz.inner.parts) {
            const lw = Math.max(NODE_W, p.blk.w);
            const ly = y + HEAD + (sz.inner.showLabel ? LANE_HEAD : 0);
            if (sz.inner.showLabel) lanesRel.push({ x: lx, y: y + HEAD, w: lw, h: sz.h - HEAD - PAD / 2, label: p.branch === "true" ? "If yes" : p.branch === "false" ? "If no" : p.branch || "", owner: n.id, rel: true });
            for (const q of p.blk.placed) placed.push({ ...q, dx: q.dx + lx + (lw - p.blk.w) / 2, dy: q.dy + ly });
            for (const l of p.blk.lanesRel) lanesRel.push({ ...l, x: l.x + lx + (lw - p.blk.w) / 2, y: l.y + ly });
            edgesOut.push(...p.blk.edgesOut);
            lx += lw + GAP_X;
          }
        }
        x += sz.w + GAP_X;
      }
      y += rh + GAP_Y;
    });
    for (const n of items) for (const ra of n.runAfter) if (ids.has(ra.from)) edgesOut.push({ from: ra.from, to: n.id, states: ra.states, fault: ra.states.some((s) => s !== "Succeeded") });
    return { w, h: Math.max(0, y - GAP_Y), placed, lanesRel, edgesOut };
  }

  const triggers = flow.nodes.filter((n) => n.kind === "trigger");
  const top = flow.nodes.filter((n) => !n.parent && n.kind !== "trigger");
  const tb = block(triggers.map((t) => ({ ...t, runAfter: [] })));
  const ab = block(top);
  const width = Math.max(tb.w, ab.w) + 40;
  const put = (b: ReturnType<typeof block>, ox: number, oy: number) => {
    for (const p of b.placed) {
      const n = flow.nodes.find((x) => x.id === p.id)!;
      nodes.set(p.id, { node: n, x: ox + p.dx, y: oy + p.dy, w: p.w, h: p.h, container: CONTAINERS.has(n.kind) && flow.nodes.some((x) => x.parent === n.id) });
    }
    for (const l of b.lanesRel) lanes.push({ x: ox + l.x, y: oy + l.y, w: l.w, h: l.h, label: l.label, owner: l.owner });
    edges.push(...b.edgesOut);
  };
  put(tb, 20 + (width - 40 - tb.w) / 2, 20);
  const aoy = 20 + (triggers.length ? tb.h + GAP_Y : 0);
  put(ab, 20 + (width - 40 - ab.w) / 2, aoy);
  // triggers feed the first layer of top-level actions
  const firsts = top.filter((n) => !n.runAfter.some((r) => top.some((x) => x.id === r.from)));
  for (const t of triggers) for (const f of firsts) edges.push({ from: t.id, to: f.id, states: [], fault: false });
  // enclosing containers connect to their first child via the box itself - no edge needed
  return { nodes, edges, lanes, width, height: aoy + ab.h + 20 };
}

export type NodeDiff = "new" | "deleted" | "changed" | "same";
export interface FlowDiff { status: Map<string, NodeDiff>; counts: { new: number; deleted: number; changed: number }; edgeStatus: Map<string, "new" | "deleted"> }

const sig = (n: FlowNode) => JSON.stringify([n.type, n.operation, n.connector, n.summary, n.branch, n.parent, [...n.runAfter].map((r) => `${r.from}:${r.states.join("+")}`).sort()]);
export const edgeKey = (e: { from: string; to: string }) => `${e.from}>${e.to}`;

/** Diff two versions of a flow by node id (parent path + name): source (new version) vs target (deployed version). */
export function diffFlows(source: ParsedFlow, target: ParsedFlow): FlowDiff {
  const a = new Map(source.nodes.map((n) => [n.id, n])), b = new Map(target.nodes.map((n) => [n.id, n]));
  const status = new Map<string, NodeDiff>();
  const counts = { new: 0, deleted: 0, changed: 0 };
  for (const [id, n] of a) {
    const t = b.get(id);
    if (!t) { status.set(id, "new"); counts.new++; } else if (sig(n) !== sig(t)) { status.set(id, "changed"); counts.changed++; } else status.set(id, "same");
  }
  for (const id of b.keys()) if (!a.has(id)) { status.set(id, "deleted"); counts.deleted++; }
  const edgeStatus = new Map<string, "new" | "deleted">();
  const ea = new Set(source.nodes.flatMap((n) => n.runAfter.map((r) => edgeKey({ from: r.from, to: n.id }))));
  const eb = new Set(target.nodes.flatMap((n) => n.runAfter.map((r) => edgeKey({ from: r.from, to: n.id }))));
  for (const k of ea) if (!eb.has(k)) edgeStatus.set(k, "new");
  for (const k of eb) if (!ea.has(k)) edgeStatus.set(k, "deleted");
  return { status, counts, edgeStatus };
}
