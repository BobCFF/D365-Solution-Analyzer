import type { ConnectionInput } from "./d365/environment";
import type { Ctx } from "./server/auth";
import { DecryptionError, sealJson, unsealJson } from "./server/crypto";
import { log } from "./server/log";

/** Saved Dynamics 365 connections. The whole config (including the client secret) is one sealed value. */
const PURPOSE = "connection.config";
export const MAX_CONNECTIONS = 10;
export interface ConnectionSummary { id: string; name: string; environmentUrl: string; tenantId: string; clientId: string; createdAt: string }

const summary = (id: string, createdAt: string, c: ConnectionInput): ConnectionSummary => ({ id, name: c.name, environmentUrl: c.environmentUrl, tenantId: c.tenantId, clientId: c.clientId, createdAt });

/** Never returns the secret. Rows that cannot be decrypted are counted, not fatal. */
export async function listConnections(ctx: Ctx): Promise<{ connections: ConnectionSummary[]; unreadable: number }> {
  const { data, error } = await ctx.db.from("d365_connections").select("id, config, created_at").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const connections: ConnectionSummary[] = [];
  let unreadable = 0;
  for (const r of data ?? []) {
    try { connections.push(summary(r.id, r.created_at, unsealJson<ConnectionInput>(ctx.userId, PURPOSE, r.config))); }
    catch (e) { if (!(e instanceof DecryptionError)) throw e; unreadable++; }
  }
  if (unreadable) log.warn("unreadable_rows", { table: "d365_connections", count: unreadable });
  return { connections, unreadable };
}

/** Server-side only: includes the client secret. */
export async function getConnection(ctx: Ctx, id: string): Promise<(ConnectionInput & { id: string }) | null> {
  const { data, error } = await ctx.db.from("d365_connections").select("id, config").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { id: data.id, ...unsealJson<ConnectionInput>(ctx.userId, PURPOSE, data.config) } : null;
}

export async function countConnections(ctx: Ctx): Promise<number> {
  const { count, error } = await ctx.db.from("d365_connections").select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function insertConnection(ctx: Ctx, input: ConnectionInput): Promise<ConnectionSummary> {
  const { data, error } = await ctx.db.from("d365_connections").insert({ config: sealJson(ctx.userId, PURPOSE, input) }).select("id, created_at").single();
  if (error) throw new Error(error.message);
  return summary(data.id, data.created_at, input);
}

export async function deleteConnection(ctx: Ctx, id: string) {
  const { error } = await ctx.db.from("d365_connections").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
