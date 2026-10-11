"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { diffFlows, edgeKey, layoutFlow, type FlowDiff, type NodeDiff } from "@/lib/d365/flowLayout";
import type { FlowNode, ParsedFlow } from "@/lib/d365/types";

const KIND_LABEL: Record<string, string> = { trigger: "Trigger", connector: "Connector", condition: "Condition", switch: "Switch", loop: "Loop", scope: "Scope", childflow: "Child flow", http: "HTTP", data: "Data", wait: "Wait", end: "End", action: "Action" };
const KIND_GLYPH: Record<string, string> = { trigger: "⚡", connector: "🔌", condition: "⑂", switch: "⑃", loop: "↻", scope: "▣", childflow: "⤵", http: "🌐", data: "ƒ", wait: "⏱", end: "■", action: "●" };

/**
 * Pure-SVG Power Automate flow viewer: nested layout, pan (drag) + zoom (wheel), click for details, and an optional
 * diff against another version of the same flow (new / changed / deleted highlighting, like Salesforce Analyzer's flow compare).
 */
export function FlowDiagram({ flow, against }: { flow: ParsedFlow; against?: ParsedFlow | null }) {
  // With a diff, draw the union so deleted steps remain visible.
  const diff: FlowDiff | null = useMemo(() => (against ? diffFlows(flow, against) : null), [flow, against]);
  const shown: ParsedFlow = useMemo(() => {
    if (!against || !diff) return flow;
    const have = new Set(flow.nodes.map((n) => n.id));
    return { ...flow, nodes: [...flow.nodes, ...against.nodes.filter((n) => !have.has(n.id))] };
  }, [flow, against, diff]);
  const layout = useMemo(() => layoutFlow(shown), [shown]);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [sel, setSel] = useState<string | null>(null);
  const [dim, setDim] = useState(false);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  const fit = useCallback(() => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return;
    const k = Math.min(1, r.width / layout.width, r.height / layout.height);
    setView({ k, x: (r.width - layout.width * k) / 2, y: 8 });
  }, [layout]);
  useEffect(() => { fit(); }, [fit]);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    // non-passive so the page does not scroll while zooming
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const f = e.deltaY < 0 ? 1.1 : 0.9; setView((v) => ({ ...v, k: Math.max(0.15, Math.min(2.5, v.k * f)) })); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const statusOf = (id: string): NodeDiff | undefined => diff?.status.get(id);
  const sn = sel ? shown.nodes.find((n) => n.id === sel) : null;
  const other = sel && against ? against.nodes.find((n) => n.id === sel) : null;

  const edgePath = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => {
    const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y;
    if (y2 > y1) { const m = (y1 + y2) / 2; return `M${x1},${y1} C${x1},${m} ${x2},${m} ${x2},${y2}`; }
    const side = Math.max(a.x + a.w, b.x + b.w) + 24; // same-row siblings: loop around the right
    return `M${a.x + a.w},${a.y + a.h / 2} C${side},${a.y + a.h / 2} ${side},${b.y + b.h / 2} ${b.x + b.w},${b.y + b.h / 2}`;
  };

  return (
    <div className="fd">
      <div className="toolbar">
        {diff && <>
          <span className="chip fd-new">{diff.counts.new} new</span><span className="chip fd-changed">{diff.counts.changed} changed</span><span className="chip fd-deleted">{diff.counts.deleted} deleted</span>
          <label className="row"><input type="checkbox" checked={dim} onChange={(e) => setDim(e.target.checked)} /> Highlight changes only</label>
        </>}
        <span className="grow" />
        <button className="btn ghost sm" onClick={() => setView((v) => ({ ...v, k: Math.min(2.5, v.k * 1.2) }))} aria-label="Zoom in">＋</button>
        <button className="btn ghost sm" onClick={() => setView((v) => ({ ...v, k: Math.max(0.15, v.k / 1.2) }))} aria-label="Zoom out">−</button>
        <button className="btn ghost sm" onClick={fit}>Fit</button>
      </div>
      <div className="fd-body">
        <svg ref={svg} className="fd-svg" role="img" aria-label={`Flow diagram: ${flow.name}`} tabIndex={0}
          onPointerDown={(e) => { if ((e.target as Element).closest(".fd-node")) return; drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; (e.currentTarget as Element).setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { const d = drag.current; if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y })); }}
          onPointerUp={() => { drag.current = null; }}
          onKeyDown={(e) => { if (e.key === "Escape") setSel(null); }}>
          <defs>
            {["", "new", "deleted"].map((s) => (
              <marker key={s} id={`fd-arrow${s}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" className={`fd-arrowhead ${s}`} /></marker>
            ))}
          </defs>
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {layout.lanes.map((l, i) => (<g key={i}><rect className="fd-lane" x={l.x} y={l.y} width={l.w} height={l.h} rx={8} /><text className="fd-lane-label" x={l.x + 8} y={l.y + 14}>{l.label}</text></g>))}
            {layout.nodes.size > 0 && [...layout.nodes.values()].filter((n) => n.container).map((n) => (
              <rect key={"c" + n.node.id} className={`fd-container ${statusOf(n.node.id) ?? ""}`} x={n.x} y={n.y} width={n.w} height={n.h} rx={10} />
            ))}
            {layout.edges.map((e, i) => {
              const a = layout.nodes.get(e.from), b = layout.nodes.get(e.to);
              if (!a || !b) return null;
              const es = diff?.edgeStatus.get(edgeKey(e));
              const faded = dim && diff && !es;
              return (
                <g key={i} opacity={faded ? 0.2 : 1}>
                  <path className={`fd-edge${e.fault ? " fault" : ""} ${es ?? ""}`} d={edgePath(a, b)} markerEnd={`url(#fd-arrow${es ?? ""})`} />
                  {e.fault && <text className="fd-edge-label" x={(a.x + a.w / 2 + b.x + b.w / 2) / 2 + 6} y={(a.y + a.h + b.y) / 2}>{e.states.join(" / ")}</text>}
                </g>
              );
            })}
            {[...layout.nodes.values()].map((n) => {
              const st = statusOf(n.node.id);
              const faded = dim && diff && st === "same";
              return (
                <g key={n.node.id} className={`fd-node k-${n.node.kind} ${st ?? ""}${sel === n.node.id ? " sel" : ""}`} opacity={faded ? 0.25 : 1}
                  transform={`translate(${n.x},${n.y})`} onClick={() => setSel(n.node.id)} tabIndex={0} role="button" aria-label={`${KIND_LABEL[n.node.kind]} ${n.node.name}`}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSel(n.node.id)}>
                  {!n.container && <rect className="fd-box" width={n.w} height={n.h} rx={10} />}
                  {n.container && <rect className="fd-head" width={n.w} height={34} rx={10} />}
                  <circle className="fd-glyph" cx={22} cy={n.container ? 17 : n.h / 2} r={13} />
                  <text className="fd-glyph-t" x={22} y={(n.container ? 17 : n.h / 2) + 4} textAnchor="middle">{KIND_GLYPH[n.node.kind]}</text>
                  <text className="fd-title" x={42} y={n.container ? 21 : n.h / 2 - 3}>{clip(n.node.name.replace(/_/g, " "), 22)}</text>
                  {!n.container && <text className="fd-sub" x={42} y={n.h / 2 + 13}>{clip(n.node.summary || n.node.connector || KIND_LABEL[n.node.kind], 26)}</text>}
                  {st && st !== "same" && <g transform={`translate(${n.w - 6},-8)`}><rect className={`fd-badge ${st}`} x={-52} width={52} height={16} rx={8} /><text className="fd-badge-t" x={-26} y={12} textAnchor="middle">{st}</text></g>}
                </g>
              );
            })}
          </g>
        </svg>
        {sn && (
          <aside className="fd-detail">
            <div className="row spread"><b>{sn.name}</b><button className="btn ghost sm" onClick={() => setSel(null)} aria-label="Close">✕</button></div>
            <table><tbody>
              <Prop label="Kind" a={KIND_LABEL[sn.kind]} />
              <Prop label="Type" a={sn.type} b={other?.type} />
              <Prop label="Connector" a={sn.connector} b={other?.connector} />
              <Prop label="Operation" a={sn.operation} b={other?.operation} />
              <Prop label="Detail" a={sn.summary} b={other?.summary} />
              <Prop label="Runs after" a={ra(sn)} b={other ? ra(other) : undefined} />
            </tbody></table>
            <p className="faint">Expressions and parameter values are never stored, so they are not shown.</p>
          </aside>
        )}
      </div>
    </div>
  );
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const ra = (n: FlowNode) => n.runAfter.map((r) => `${r.from.split("/").pop()} (${r.states.join(", ")})`).join("; ");
function Prop({ label, a, b }: { label: string; a?: string; b?: string }) {
  if (!a && !b) return null;
  const changed = b !== undefined && (a ?? "") !== (b ?? "");
  return <tr className={changed ? "chg" : ""}><th>{label}</th><td>{a || "—"}{changed && <div className="muted">was: {b || "—"}</div>}</td></tr>;
}
