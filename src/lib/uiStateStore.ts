/**
 * Per-user UI state kept in the browser (last page, selected solution, filters, sort, column layouts, ...).
 * Pure and storage-agnostic so it can be unit-tested. Values are validated by the caller's `normalize`, so a corrupt or
 * outdated entry falls back to its default instead of breaking the page. Nothing here is sent to the server.
 */
export interface KeyValueStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

const NS = "d365-sa-ui-v1";
const MAX_BYTES = 400_000; // keep well under typical 5 MB localStorage quotas

export interface UiStateStore {
  get<T>(key: string, initial: T, normalize?: (raw: unknown) => T): T;
  set(key: string, value: unknown): void;
  /** write pending changes now (called on a timer and when the page is hidden) */
  flush(): void;
  reset(): void;
  keys(): string[];
}

export function createUiStateStore(storage: KeyValueStorage | null, userId: string): UiStateStore {
  const storageKey = `${NS}:${userId}`;
  let data: Record<string, unknown> = {};
  try {
    const raw = storage?.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
  } catch { /* unavailable or corrupt: start empty */ }
  let dirty = false;

  const flush = () => {
    if (!dirty) return;
    dirty = false;
    try {
      let json = JSON.stringify(data);
      if (json.length > MAX_BYTES) {          // drop the largest entries until it fits (oldest table layouts are cheap to rebuild)
        const bySize = Object.entries(data).map(([k, v]) => [k, JSON.stringify(v).length] as const).sort((a, b) => b[1] - a[1]);
        for (const [k] of bySize) { delete data[k]; json = JSON.stringify(data); if (json.length <= MAX_BYTES) break; }
      }
      storage?.setItem(storageKey, json);
    } catch { /* quota or storage disabled: state just won't persist */ }
  };

  return {
    get(key, initial, normalize) {
      if (!(key in data)) return initial;
      try { return normalize ? normalize(data[key]) : (data[key] as typeof initial); } catch { return initial; }
    },
    set(key, value) { data[key] = value; dirty = true; },
    flush,
    reset() { data = {}; dirty = false; try { storage?.removeItem(storageKey); } catch { /* ignore */ } },
    keys: () => Object.keys(data),
  };
}

/* ---- normalizers shared by callers ---- */
export const asString = (raw: unknown, fallback = ""): string => (typeof raw === "string" ? raw : fallback);
export const asOneOf = <T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T => (allowed as readonly unknown[]).includes(raw) ? (raw as T) : fallback;
export const asStringArray = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, 500) : []);
export const asBool = (raw: unknown, fallback = false): boolean => (typeof raw === "boolean" ? raw : fallback);
