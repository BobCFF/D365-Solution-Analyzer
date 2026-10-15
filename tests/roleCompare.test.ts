import { describe, expect, it } from "vitest";
import { diffRoles } from "@/lib/d365/roleCompare";
import type { ParsedRole } from "@/lib/d365/types";

const role = (name: string, privileges: ParsedRole["privileges"]): ParsedRole => ({ id: name, name, privileges });

describe("security role comparison (0.14.0)", () => {
  const a = role("Sales", {
    account: { read: "org", write: "bu", delete: "user" },
    contact: { read: "org" },
    new_secret: { read: "user", create: "user" },
    empty_table: {},
  });
  const b = role("Manager", {
    account: { read: "org", write: "org", delete: "none", share: "user" },
    contact: { read: "org" },
    new_other: { read: "bu" },
    empty_table: {},
  });
  const d = diffRoles(a, b);
  const row = (t: string) => d.rows.find((r) => r.table === t)!;

  it("classifies each table", () => {
    expect(row("contact").status).toBe("same");
    expect(row("account").status).toBe("different");
    expect(row("new_secret").status).toBe("only-a");
    expect(row("new_other").status).toBe("only-b");
    expect(d.rows.some((r) => r.table === "empty_table")).toBe(false); // nothing granted on either side
  });
  it("lists the changed verbs and direction", () => {
    const acc = row("account");
    expect(acc.diffs).toEqual(["write", "delete", "share"]);
    expect(acc.moreInB).toBe(2);   // write bu->org, share none->user
    expect(acc.lessInB).toBe(1);   // delete user->none
    expect(acc.a.read).toBe("org"); expect(acc.b.append).toBe("none");
  });
  it("summarises", () => {
    expect(d.summary).toMatchObject({ tables: 4, same: 1, different: 1, onlyA: 1, onlyB: 1 });
    expect(d.summary.privilegesMoreInB).toBe(2 + 1);        // account (2) + new_other read (1)
    expect(d.summary.privilegesLessInB).toBe(1 + 2);        // account delete (1) + new_secret read/create (2)
    expect(d.summary.orgPrivilegesA).toBe(2); expect(d.summary.orgPrivilegesB).toBe(3);
  });
  it("comparing a role with itself is all identical", () => {
    const self = diffRoles(a, a);
    expect(self.rows.every((r) => r.status === "same")).toBe(true);
    expect(self.summary.privilegesMoreInB + self.summary.privilegesLessInB).toBe(0);
  });
  it("is symmetric: swapping flips more/less", () => {
    const sw = diffRoles(b, a);
    expect(sw.summary.privilegesMoreInB).toBe(d.summary.privilegesLessInB);
    expect(sw.summary.privilegesLessInB).toBe(d.summary.privilegesMoreInB);
    expect(sw.rows.find((r) => r.table === "new_secret")!.status).toBe("only-b");
  });
});
