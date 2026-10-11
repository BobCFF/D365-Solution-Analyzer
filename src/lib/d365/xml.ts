import { XMLParser } from "fast-xml-parser";

export const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

/* eslint-disable @typescript-eslint/no-explicit-any */
export const arr = (v: any): any[] => (v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : [v]);
export const text = (v: any): string => {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return String(v["#text"] ?? "");
  return String(v);
};

/** All descendant nodes with the given tag name (any depth). */
export function findAll(node: any, tag: string, out: any[] = []): any[] {
  if (node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const n of node) findAll(n, tag, out); return out; }
  for (const k of Object.keys(node)) {
    if (k.startsWith("@_") || k === "#text") continue;
    const v = node[k];
    if (k === tag) for (const item of arr(v)) out.push(item);
    findAll(v, tag, out);
  }
  return out;
}

export const guid = (s: unknown) => String(s ?? "").replace(/[{}]/g, "").toLowerCase();
