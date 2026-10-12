import { labelFor } from "./progressLabels";

/** The browser's calls to our API: JSON in/out, a non-2xx answer throws ApiError with the server's safe message. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export type Api = <T = unknown>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>;

/** `track(label)` is called when a request starts and returns the function to call when it ends (drives the busy dialog). */
export const makeApi = (token: string, track?: (label: string) => () => void): Api => async <T,>(path: string, init: RequestInit & { json?: unknown } = {}) => {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (json !== undefined) headers.set("Content-Type", "application/json");
  const done = track?.(labelFor(path, rest.method));
  try {
    const res = await fetch(path, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(body.error ?? res.statusText, res.status, body.code);
    return body as T;
  } finally { done?.(); }
};
