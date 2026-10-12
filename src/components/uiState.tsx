"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createUiStateStore, type UiStateStore } from "@/lib/uiStateStore";

const Ctx = createContext<UiStateStore | null>(null);

/** Provides the signed-in user's saved-view store. Mount with `key={userId}` so a different account never sees another's state. */
export function UiStateProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const store = useMemo(() => {
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { /* storage blocked */ }
    return createUiStateStore(storage, userId);
  }, [userId]);
  useEffect(() => {
    const flush = () => store.flush();
    const timer = setInterval(flush, 1000);
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => { clearInterval(timer); flush(); window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", onHide); };
  }, [store]);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useUiStore(): UiStateStore {
  const s = useContext(Ctx);
  if (!s) throw new Error("UiStateProvider is missing");
  return s;
}

/**
 * Like useState, but remembered per user in the browser. `normalize` validates what was saved (so stale or corrupt data
 * falls back to `initial`); it must be stable or defined at module level.
 */
export function useSavedState<T>(key: string, initial: T, normalize?: (raw: unknown) => T): [T, (v: T | ((prev: T) => T)) => void] {
  const store = useUiStore();
  const [value, setValue] = useState<T>(() => store.get(key, initial, normalize));
  const latest = useRef(value);
  const set = useCallback((v: T | ((prev: T) => T)) => {
    const next = typeof v === "function" ? (v as (p: T) => T)(latest.current) : v;
    latest.current = next;
    setValue(next);
    store.set(key, next);
  }, [store, key]);
  return [value, set];
}
