import { componentTypeName } from "./componentTypes";
import type { ParsedSolution } from "./types";

export interface ComponentDiff {
  type: number;
  typeName: string;
  key: string;
  displayName?: string;
}
export interface ChangedComponent extends ComponentDiff {
  changes: string[];
}
export interface SolutionComparison {
  left: { uniqueName: string; version: string; managed: boolean };
  right: { uniqueName: string; version: string; managed: boolean };
  metadata: { field: string; left: string; right: string }[];
  added: ComponentDiff[];
  removed: ComponentDiff[];
  changed: ChangedComponent[];
  unchangedCount: number;
}

interface Item {
  type: number;
  key: string;
  displayName?: string;
  behavior?: number;
  attributes?: string[];
  details?: Record<string, unknown>;
}

function collect(s: ParsedSolution): Map<string, Item> {
  const m = new Map<string, Item>();
  const id = (t: number, k: string) => `${t}:${k.toLowerCase()}`;
  for (const rc of s.rootComponents) m.set(id(rc.type, rc.key), { type: rc.type, key: rc.key, behavior: rc.behavior });
  for (const it of s.inventory) {
    const k = id(it.type, it.key);
    const prev = m.get(k);
    m.set(k, {
      ...prev, type: it.type, key: prev?.key ?? it.key, displayName: it.displayName,
      attributes: Array.isArray(it.details?.attributes) ? (it.details.attributes as string[]) : undefined,
      details: it.details,
    });
  }
  return m;
}

export function compareSolutions(left: ParsedSolution, right: ParsedSolution): SolutionComparison {
  const l = collect(left), r = collect(right);
  const toDiff = (i: Item): ComponentDiff => ({ type: i.type, typeName: componentTypeName(i.type), key: i.key, displayName: i.displayName });
  const added: ComponentDiff[] = [], removed: ComponentDiff[] = [], changed: ChangedComponent[] = [];
  let unchanged = 0;

  for (const [k, ri] of r) {
    const li = l.get(k);
    if (!li) { added.push(toDiff(ri)); continue; }
    const changes: string[] = [];
    if (li.behavior !== undefined && ri.behavior !== undefined && li.behavior !== ri.behavior)
      changes.push(`root component behavior ${li.behavior} -> ${ri.behavior}`);
    if (li.attributes && ri.attributes) {
      const ls = new Set(li.attributes), rs = new Set(ri.attributes);
      const add = ri.attributes.filter((a) => !ls.has(a)), rem = li.attributes.filter((a) => !rs.has(a));
      if (add.length) changes.push(`columns added: ${add.join(", ")}`);
      if (rem.length) changes.push(`columns removed: ${rem.join(", ")}`);
    }
    for (const dk of new Set([...Object.keys(li.details ?? {}), ...Object.keys(ri.details ?? {})])) {
      if (dk === "attributes" || dk === "attributeCount") continue;
      const a = JSON.stringify(li.details?.[dk]), b = JSON.stringify(ri.details?.[dk]);
      if (a !== b) changes.push(`${dk}: ${a ?? "-"} -> ${b ?? "-"}`);
    }
    if (changes.length) changed.push({ ...toDiff(ri), changes }); else unchanged++;
  }
  for (const [k, li] of l) if (!r.has(k)) removed.push(toDiff(li));

  const meta = (s: ParsedSolution) => ({
    version: s.version, managed: s.managed ? "managed" : "unmanaged",
    publisher: s.publisher?.uniqueName ?? "", prefix: s.publisher?.customizationPrefix ?? "",
    parent: s.parentSolutionName ?? "",
  });
  const lm = meta(left), rm = meta(right);
  const metadata = (Object.keys(lm) as (keyof typeof lm)[])
    .filter((f) => lm[f] !== rm[f]).map((f) => ({ field: f, left: lm[f], right: rm[f] }));

  const sum = (s: ParsedSolution) => ({ uniqueName: s.uniqueName, version: s.version, managed: s.managed });
  return { left: sum(left), right: sum(right), metadata, added, removed, changed, unchangedCount: unchanged };
}
