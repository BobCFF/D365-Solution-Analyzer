import type { ParsedSolution } from "./types";

const MAX_ITEMS = 50_000;

/**
 * The browser parses the package and sends only the parsed model. Never trust it:
 * check the shape and bound the size before it is analyzed or stored.
 */
export function validateParsed(input: unknown): ParsedSolution {
  const s = input as Partial<ParsedSolution> | null;
  const bad = (m: string) => { throw new Error(`Invalid solution payload: ${m}`); };
  if (!s || typeof s !== "object") bad("not an object");
  const str = (v: unknown, name: string, max = 500) => { if (typeof v !== "string" || v.length > max) bad(name); };
  str(s!.uniqueName, "uniqueName", 200); str(s!.friendlyName, "friendlyName", 500); str(s!.version, "version", 50);
  if (!s!.uniqueName) bad("uniqueName empty");
  if (typeof s!.managed !== "boolean") bad("managed");
  if (s!.parentSolutionName !== null && s!.parentSolutionName !== undefined) str(s!.parentSolutionName, "parentSolutionName", 200);
  for (const k of ["rootComponents", "missingDependencies", "inventory", "files"] as const) {
    const v = s![k];
    if (!Array.isArray(v) || v.length > MAX_ITEMS) bad(k);
  }
  for (const k of ["entities", "relationships", "roles", "fieldProfiles", "siteMaps", "apps", "flows", "references"] as const) {
    const v = s![k];
    if (v !== undefined && (!Array.isArray(v) || v.length > MAX_ITEMS)) bad(k);
  }
  for (const rc of s!.rootComponents!) if (typeof rc?.type !== "number" || typeof rc?.key !== "string") bad("rootComponents item");
  for (const i of s!.inventory!) if (typeof i?.type !== "number" || typeof i?.key !== "string" || typeof i?.typeName !== "string") bad("inventory item");
  return { parentSolutionName: null, publisher: null, ...s } as ParsedSolution;
}
