import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { ParsedSolution } from "@/lib/d365/types";
import { resetKeyringForTests, unsealJson } from "@/lib/server/crypto";
import { insertSolution, logChange, saveFindings } from "@/lib/store";

const USER = "11111111-1111-1111-1111-111111111111";
const sol: ParsedSolution = {
  uniqueName: "AcmeSecretProject", friendlyName: "Acme Confidential CRM", version: "1.0.0.0", managed: false, parentSolutionName: null,
  publisher: { uniqueName: "acmecorp", customizationPrefix: "acme", customizationOptionValuePrefix: 10000 },
  rootComponents: [{ type: 1, key: "acme_payroll", behavior: 0 }], missingDependencies: [], inventory: [], files: ["solution.xml"],
};

/** Minimal Supabase stand-in that records everything written. */
function fakeDb() {
  const writes: { table: string; rows: unknown }[] = [];
  const db = { from: (table: string) => ({
    insert: (rows: unknown) => { writes.push({ table, rows }); const r = { data: { id: "row-1" }, error: null }; return Object.assign(Promise.resolve(r), { select: () => ({ single: async () => r }) }); },
    delete: () => ({ eq: async () => ({ error: null }) }),
  }) };
  return { db: db as never, writes };
}

describe("storage never receives plaintext", () => {
  beforeAll(() => { process.env.DATA_ENCRYPTION_KEY = `t1:${randomBytes(32).toString("base64")}`; resetKeyringForTests(); });

  it("seals solution rows, findings and log entries", async () => {
    const { db, writes } = fakeDb();
    const ctx = { db, userId: USER, email: "a@b.c" };
    await insertSolution(ctx, sol, "AcmeExport.zip", "a".repeat(64));
    await saveFindings(ctx, "sid", [{ ruleId: "DEP101", severity: "error", title: "Missing table", detail: "acme_payroll is required by Acme form", remediation: "Add acme_payroll", componentKey: "acme_payroll" }]);
    await logChange(ctx, "upload", "solution", "row-1", "Loaded AcmeSecretProject 1.0.0.0");

    const dump = JSON.stringify(writes);
    for (const secret of ["AcmeSecretProject", "Acme Confidential", "acme_payroll", "acmecorp", "AcmeExport", "payroll"]) expect(dump).not.toContain(secret);
    const s = writes.find((w) => w.table === "solutions")!.rows as { meta: string; parsed: string; unique_key: string; file_hmac: string };
    expect(s.unique_key).toMatch(/^[0-9a-f]{64}$/);
    expect(s.file_hmac).not.toBe("a".repeat(64)); // keyed, not the raw file hash
    expect(unsealJson<{ uniqueName: string }>(USER, "solution.meta", s.meta).uniqueName).toBe("AcmeSecretProject");
    expect(unsealJson<ParsedSolution>(USER, "solution.parsed", s.parsed).rootComponents[0].key).toBe("acme_payroll");
  });

  it("derives different duplicate keys per user", async () => {
    const a = fakeDb(), b = fakeDb();
    await insertSolution({ db: a.db, userId: USER, email: "" }, sol, "f.zip", "b".repeat(64));
    await insertSolution({ db: b.db, userId: "22222222-2222-2222-2222-222222222222", email: "" }, sol, "f.zip", "b".repeat(64));
    const k = (w: typeof a.writes) => (w[0].rows as { unique_key: string }).unique_key;
    expect(k(a.writes)).not.toBe(k(b.writes));
  });
});
