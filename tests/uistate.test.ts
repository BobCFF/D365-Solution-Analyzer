import { describe, expect, it } from "vitest";
import { asBool, asOneOf, asString, asStringArray, createUiStateStore, type KeyValueStorage } from "@/lib/uiStateStore";

const mem = (): KeyValueStorage & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};

describe("saved UI state", () => {
  it("round-trips values per user after a flush", () => {
    const st = mem();
    const a = createUiStateStore(st, "u1");
    a.set("page", "analysis"); a.set("table:missing", { filters: { sev: ["error"] } });
    expect(st.m.size).toBe(0);                      // writes are batched until flush
    a.flush();
    const again = createUiStateStore(st, "u1");
    expect(again.get("page", "solutions")).toBe("analysis");
    expect(again.get("table:missing", null)).toEqual({ filters: { sev: ["error"] } });
    expect(createUiStateStore(st, "u2").get("page", "solutions")).toBe("solutions");   // other account sees nothing
  });

  it("falls back to the default for missing, corrupt or invalid entries", () => {
    const st = mem();
    st.m.set("d365-sa-ui-v1:u1", "{not json");
    expect(createUiStateStore(st, "u1").get("page", "solutions")).toBe("solutions");
    const s = createUiStateStore(st, "u1");
    s.set("page", 42); s.flush();
    expect(s.get("page", "solutions", (r) => asOneOf(r, ["solutions", "analysis"] as const, "solutions"))).toBe("solutions");
    expect(s.get("x", 1, () => { throw new Error("boom"); })).toBe(1);
  });

  it("resets and survives unavailable or full storage", () => {
    const st = mem(); const s = createUiStateStore(st, "u1"); s.set("a", 1); s.flush(); s.reset();
    expect(st.m.size).toBe(0); expect(s.keys()).toEqual([]);
    const broken: KeyValueStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("blocked"); } };
    const b = createUiStateStore(broken, "u1"); b.set("a", 1); expect(() => b.flush()).not.toThrow(); expect(b.get("a", 0)).toBe(1);
    expect(() => createUiStateStore(null, "u1").reset()).not.toThrow();
  });

  it("drops the largest entries when over the size cap", () => {
    const st = mem(); const s = createUiStateStore(st, "u1");
    s.set("small", "x"); s.set("huge", "y".repeat(500_000)); s.flush();
    const back = createUiStateStore(st, "u1");
    expect(back.get("small", "")).toBe("x"); expect(back.get("huge", "gone")).toBe("gone");
  });

  it("normalizers coerce junk safely", () => {
    expect(asString(5, "d")).toBe("d"); expect(asBool("x", true)).toBe(true);
    expect(asStringArray(["a", 1, "b"])).toEqual(["a", "b"]); expect(asStringArray("no")).toEqual([]);
    expect(asOneOf("zzz", ["a", "b"] as const, "a")).toBe("a");
  });
});
