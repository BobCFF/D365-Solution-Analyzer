import { z } from "zod";
import type { ParsedSolution } from "./types";

/**
 * The browser parses the package and sends only the parsed model. Never trust it: the server re-runs the analyzer on
 * this structure, so it is validated deeply (types, string lengths, array sizes). Unknown keys are dropped, so nothing
 * unexpected can be stored. (Salesforce Analyzer: "check request bodies with zod".)
 */
const str = (max = 1000) => z.string().max(max);
const int = z.number().int().min(-1).max(1_000_000);
const MAX = 50_000;
const arr = <T extends z.ZodTypeAny>(t: T, max = MAX) => z.array(t).max(max);

const attribute = z.object({
  name: str(200), type: str(100), required: str(100), display: str(500),
  custom: z.boolean().optional(), secured: z.boolean().optional(), audit: z.boolean().optional(),
  optionSet: str(200).optional(), maxLength: str(20).optional(), format: str(50).optional(), pk: z.boolean().optional(),
  targets: arr(str(200), 200).optional(),
});
const level = z.enum(["none", "user", "bu", "deep", "org"]);
const flowNode = z.object({
  id: str(600), name: str(300), type: str(100),
  kind: z.enum(["trigger", "connector", "condition", "switch", "loop", "scope", "childflow", "http", "data", "wait", "end", "action"]),
  parent: str(600).optional(), branch: str(300).optional(), connector: str(200).optional(), operation: str(200).optional(), summary: str(400).optional(),
  runAfter: arr(z.object({ from: str(600), states: arr(str(50), 10) }), 200),
});
const subArea = z.object({
  id: str(200), title: str(500), entity: str(200).optional(), url: str(1000).optional(), icon: str(1000).optional(), dashboard: str(100).optional(),
  privileges: arr(z.object({ entity: str(200), privilege: str(50) }), 100),
});
const detail = z.record(str(200), z.union([z.string().max(2000), z.number(), z.boolean(), arr(z.string().max(200), 20_000)]));
const ref = z.object({ type: int, key: str(1000), name: str(500).optional() });

export const parsedSolutionSchema = z.object({
  uniqueName: str(200).min(1), friendlyName: str(500), version: str(50), managed: z.boolean(),
  parentSolutionName: str(200).nullable().default(null),
  publisher: z.object({ uniqueName: str(200), customizationPrefix: str(50), customizationOptionValuePrefix: z.number().int().nullable() }).nullable().default(null),
  rootComponents: arr(z.object({ type: int, key: str(1000), behavior: int })),
  missingDependencies: arr(z.object({ requiredType: str(200), requiredName: str(500), requiredSolution: str(200), dependentType: str(200), dependentName: str(500), requiredKey: str(500).optional(), requiredParent: str(500).optional(), requiredSolutionName: str(200).optional(), requiredSolutionVersion: str(50).optional(), dependentKey: str(500).optional(), dependentParent: str(500).optional() })),
  inventory: arr(z.object({ type: int, typeName: str(200), key: str(1000), displayName: str(500).optional(), details: detail.optional() })),
  entities: arr(z.object({ logical: str(200), display: str(500), prefix: str(50), attributes: arr(attribute, 5000) })).optional(),
  relationships: arr(z.object({ name: str(300), type: str(50), referenced: str(200), referencing: str(200), attribute: str(200), category: z.enum(["business", "ownership", "audit", "portal", "generic"]) })).optional(),
  roles: arr(z.object({ id: str(100), name: str(300), privileges: z.record(str(200), z.record(str(20), level)) }), 5000).optional(),
  fieldProfiles: arr(z.object({ id: str(100), name: str(300), permissions: arr(z.object({ entity: str(200), attribute: str(200), create: z.boolean(), read: z.boolean(), update: z.boolean() })) }), 5000).optional(),
  siteMaps: arr(z.object({ id: str(100), name: str(300), areas: arr(z.object({ id: str(200), title: str(500), icon: str(1000).optional(), groups: arr(z.object({ id: str(200), title: str(500), subAreas: arr(subArea, 2000) }), 500) }), 500) }), 200).optional(),
  apps: arr(z.object({ uniqueName: str(200), name: str(500), components: arr(z.object({ type: int, key: str(1000) })), roles: arr(str(100), 5000) }), 2000).optional(),
  flows: arr(z.object({ id: str(100), name: str(300), category: int, stateCode: int, nodes: arr(flowNode, 5000), connectionRefs: arr(str(300), 500), envVars: arr(str(300), 500), childFlows: arr(str(100), 500) }), 3000).optional(),
  references: arr(z.object({ from: ref, kind: str(60), to: ref, detail: str(1000).optional() })).optional(),
  files: arr(str(1000)),
});

export function validateParsed(input: unknown): ParsedSolution {
  const r = parsedSolutionSchema.safeParse(input);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new Error(`Invalid solution payload: ${i.path.join(".") || "root"} (${i.message})`);
  }
  return r.data as ParsedSolution;
}
