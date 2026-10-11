import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

/**
 * Application-level encryption for everything content-bearing that we store in Supabase.
 *
 *  - AES-256-GCM, random 96-bit IV per value.
 *  - Per-user subkey = HKDF-SHA256(master key, info = "user:<uid>"), so one user's ciphertext can never be
 *    decrypted under another user's identity even if rows were swapped in the database.
 *  - AAD binds the ciphertext to `<uid>|<purpose>` (which column it belongs to): copying a value into another
 *    column or onto another user's row fails authentication.
 *  - Envelope `enc:v1:<keyId>:<iv>:<ciphertext+tag>` (base64url) carries the key id so keys can be rotated.
 *
 * Fail closed: without DATA_ENCRYPTION_KEY nothing is stored (never fall back to plaintext).
 * Server-only: never import this from a client component.
 */
const PREFIX = "enc:v1:";
import { getEnv, type EnvRecord } from "./config";

export interface Keyring { current: { id: string; key: Buffer }; byId: Map<string, Buffer> }

export class EncryptionConfigError extends Error {}
export class DecryptionError extends Error {}

function parseKey(spec: string, fallbackId: string): { id: string; key: Buffer } {
  const i = spec.indexOf(":");
  const id = i > 0 && i < 24 ? spec.slice(0, i) : fallbackId;
  const b64 = i > 0 && i < 24 ? spec.slice(i + 1) : spec;
  const key = Buffer.from(b64.trim(), "base64");
  if (key.length !== 32) throw new EncryptionConfigError("Encryption keys must be 32 bytes, base64 encoded (generate with: openssl rand -base64 32).");
  if (!/^[A-Za-z0-9_-]{1,24}$/.test(id)) throw new EncryptionConfigError("Encryption key id must be 1-24 characters of [A-Za-z0-9_-].");
  return { id, key };
}

/** DATA_ENCRYPTION_KEY = "<id>:<base64>" (or bare base64, id "k1"); DATA_ENCRYPTION_KEYS_PREVIOUS = comma-separated, for rotation. */
export function loadKeyring(env: EnvRecord = process.env): Keyring {
  const cur = getEnv("DATA_ENCRYPTION_KEY", env)?.trim();
  if (!cur) throw new EncryptionConfigError("DATA_ENCRYPTION_KEY (or D365_SolAna_DATA_ENCRYPTION_KEY) is not set; refusing to store data unencrypted.");
  const current = parseKey(cur, "k1");
  const byId = new Map([[current.id, current.key]]);
  for (const [n, spec] of (getEnv("DATA_ENCRYPTION_KEYS_PREVIOUS", env) ?? "").split(",").map((s) => s.trim()).filter(Boolean).entries()) {
    const k = parseKey(spec, `p${n + 1}`);
    if (byId.has(k.id)) throw new EncryptionConfigError(`Duplicate encryption key id "${k.id}".`);
    byId.set(k.id, k.key);
  }
  return { current, byId };
}

let cached: Keyring | null = null;
const ring = () => (cached ??= loadKeyring());
/** test hook */
export function resetKeyringForTests() { cached = null; }

const subKey = (master: Buffer, userId: string) =>
  Buffer.from(hkdfSync("sha256", master, Buffer.from("d365-solution-analyzer/v1"), Buffer.from(`user:${userId}`), 32));
const aad = (userId: string, purpose: string) => Buffer.from(`${userId}|${purpose}`);
const b64u = (b: Buffer) => b.toString("base64url");

export const isSealed = (v: unknown): v is string => typeof v === "string" && v.startsWith(PREFIX);

export function seal(userId: string, purpose: string, plaintext: string, keyring: Keyring = ring()): string {
  if (!userId) throw new EncryptionConfigError("Cannot encrypt without a user id.");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", subKey(keyring.current.key, userId), iv);
  c.setAAD(aad(userId, purpose));
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final(), c.getAuthTag()]);
  return `${PREFIX}${keyring.current.id}:${b64u(iv)}:${b64u(ct)}`;
}

export function unseal(userId: string, purpose: string, sealed: string, keyring: Keyring = ring()): string {
  if (!isSealed(sealed)) throw new DecryptionError("Value is not encrypted.");
  const [kid, ivS, ctS] = sealed.slice(PREFIX.length).split(":");
  const master = keyring.byId.get(kid);
  if (!master || !ivS || !ctS) throw new DecryptionError("Unknown key id or malformed value.");
  const raw = Buffer.from(ctS, "base64url");
  if (raw.length < 16) throw new DecryptionError("Malformed value.");
  try {
    const d = createDecipheriv("aes-256-gcm", subKey(master, userId), Buffer.from(ivS, "base64url"));
    d.setAAD(aad(userId, purpose));
    d.setAuthTag(raw.subarray(raw.length - 16));
    return Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString("utf8");
  } catch {
    throw new DecryptionError("Could not decrypt (wrong key, wrong owner, or tampered data).");
  }
}

export const sealJson = (userId: string, purpose: string, value: unknown, keyring?: Keyring) => seal(userId, purpose, JSON.stringify(value), keyring);
export const unsealJson = <T>(userId: string, purpose: string, sealed: string, keyring?: Keyring): T => JSON.parse(unseal(userId, purpose, sealed, keyring)) as T;

/** True if the value was sealed with a non-current key (candidate for re-encryption). */
export function needsRotation(sealed: string, keyring: Keyring = ring()): boolean {
  return isSealed(sealed) && sealed.slice(PREFIX.length).split(":")[0] !== keyring.current.id;
}

/** Keyed per-user hash (HMAC-SHA256 under an HKDF subkey separated from the encryption subkey). */
export function mac(userId: string, label: string, value: string, keyring: Keyring = ring()): string {
  const k = Buffer.from(hkdfSync("sha256", keyring.current.key, Buffer.from("d365-solution-analyzer/mac"), Buffer.from(`${label}:${userId}`), 32));
  return createHmac("sha256", k).update(value).digest("hex");
}
