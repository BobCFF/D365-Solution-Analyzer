import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DecryptionError, EncryptionConfigError, isSealed, loadKeyring, needsRotation, seal, sealJson, unseal, unsealJson } from "@/lib/server/crypto";

const key = () => randomBytes(32).toString("base64");
const ring = loadKeyring({ DATA_ENCRYPTION_KEY: `a:${key()}` });
const U1 = "11111111-1111-1111-1111-111111111111", U2 = "22222222-2222-2222-2222-222222222222";

describe("encryption", () => {
  it("round-trips and never leaks plaintext", () => {
    const s = seal(U1, "solution.parsed", "Contoso_Secret_Table", ring);
    expect(isSealed(s)).toBe(true);
    expect(s).not.toContain("Contoso");
    expect(unseal(U1, "solution.parsed", s, ring)).toBe("Contoso_Secret_Table");
    expect(unsealJson<{ a: number }>(U1, "x", sealJson(U1, "x", { a: 1 }, ring), ring)).toEqual({ a: 1 });
  });
  it("uses a fresh IV each time", () => {
    expect(seal(U1, "p", "same", ring)).not.toBe(seal(U1, "p", "same", ring));
  });
  it("rejects another user, another column, and tampering", () => {
    const s = seal(U1, "solution.parsed", "data", ring);
    expect(() => unseal(U2, "solution.parsed", s, ring)).toThrow(DecryptionError);
    expect(() => unseal(U1, "finding.detail", s, ring)).toThrow(DecryptionError);
    const parts = s.split(":");
    parts[4] = (parts[4][0] === "A" ? "B" : "A") + parts[4].slice(1);
    expect(() => unseal(U1, "solution.parsed", parts.join(":"), ring)).toThrow(DecryptionError);
    expect(() => unseal(U1, "solution.parsed", "plain text", ring)).toThrow(DecryptionError);
  });
  it("supports key rotation via previous keys", () => {
    const old = key(), next = key();
    const oldRing = loadKeyring({ DATA_ENCRYPTION_KEY: `old:${old}` });
    const s = seal(U1, "p", "hello", oldRing);
    const newRing = loadKeyring({ DATA_ENCRYPTION_KEY: `new:${next}`, DATA_ENCRYPTION_KEYS_PREVIOUS: `old:${old}` });
    expect(unseal(U1, "p", s, newRing)).toBe("hello");
    expect(needsRotation(s, newRing)).toBe(true);
    expect(needsRotation(seal(U1, "p", "x", newRing), newRing)).toBe(false);
    expect(() => unseal(U1, "p", s, loadKeyring({ DATA_ENCRYPTION_KEY: `new:${next}` }))).toThrow(DecryptionError);
  });
  it("fails closed when misconfigured", () => {
    expect(() => loadKeyring({})).toThrow(EncryptionConfigError);
    expect(() => loadKeyring({ DATA_ENCRYPTION_KEY: "short" })).toThrow(EncryptionConfigError);
  });
});
