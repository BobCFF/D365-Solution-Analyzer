import JSZip from "jszip";
import { arr, findAll, guid, text, xml } from "./xml";
import { parseApps, parseSiteMaps, webResourceName } from "./navigation";
import { parseFlowJson } from "./flow";
import { componentTypeName } from "./componentTypes";
import { CT_CONNECTION_REFERENCE } from "./types";
import type {
  AccessLevel,
  EntityAttribute,
  FieldPermission,
  InventoryItem,
  ParsedEntity,
  ParsedFlow,
  ParsedApp,
  ParsedSiteMap,
  Reference,
  ParsedFieldProfile,
  ParsedRelationship,
  ParsedRole,
  RelationshipCategory,
  MissingDependency,
  ParsedSolution,
  Publisher,
  RootComponent,
} from "./types";

export class SolutionParseError extends Error {}

const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

/**
 * Parse a Dataverse solution (.zip) as exported by the platform / `pac solution export`.
 * Reads solution.xml (manifest), customizations.xml (components) and the package file list.
 */
export async function parseSolutionZip(data: Uint8Array | ArrayBuffer | Buffer): Promise<ParsedSolution> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new SolutionParseError("File is not a valid ZIP archive.");
  }
  const files = Object.keys(zip.files).filter((f) => !zip.files[f].dir);

  // Guard against zip bombs using declared sizes.
  let total = 0;
  for (const f of files) {
    total += (zip.files[f] as any)._data?.uncompressedSize ?? 0;
    if (total > MAX_UNCOMPRESSED_BYTES) throw new SolutionParseError("Package is too large when uncompressed.");
  }

  const solutionXml = await zip.file("solution.xml")?.async("string");
  if (!solutionXml) throw new SolutionParseError("solution.xml not found - not a Dataverse solution package.");
  const customizationsXml = await zip.file("customizations.xml")?.async("string");

  const parsed = parseSolutionXml(solutionXml);
  parsed.files = files;
  if (customizationsXml) {
    const { workflowMeta, ...model } = parseCustomizationsXml(customizationsXml);
    Object.assign(parsed, model);
    // Cloud flows live in Workflows/*.json next to customizations.xml; keep a safe summary model only.
    const byFile = new Map(workflowMeta.map((w) => [w.file.toLowerCase().replace(/^\//, ""), w]));
    const flows: ParsedFlow[] = [];
    for (const f of files.filter((n) => /^workflows\/.+\.json$/i.test(n))) {
      const meta = byFile.get(f.toLowerCase());
      const idFromName = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/i.exec(f)?.[1] ?? f;
      const flow = parseFlowJson(await zip.files[f].async("string"), {
        id: (meta?.id ?? idFromName).toLowerCase(), name: meta?.name ?? f.replace(/^Workflows\//i, "").replace(/\.json$/i, ""),
        category: meta?.category ?? 5, stateCode: meta?.stateCode ?? -1,
      });
      if (flow) flows.push(flow);
    }
    parsed.flows = flows;
  }
  return parsed;
}

export function parseSolutionXml(content: string): ParsedSolution {
  const root = xml.parse(content)?.ImportExportXml?.SolutionManifest;
  if (!root) throw new SolutionParseError("solution.xml has no SolutionManifest element.");

  const localized = arr(root.LocalizedNames?.LocalizedName);
  const friendlyName = text(localized[0]?.["@_description"]) || text(root.UniqueName);

  let publisher: Publisher | null = null;
  if (root.Publisher) {
    const p = root.Publisher;
    const ov = text(p.CustomizationOptionValuePrefix);
    publisher = {
      uniqueName: text(p.UniqueName),
      customizationPrefix: text(p.CustomizationPrefix),
      customizationOptionValuePrefix: ov === "" ? null : Number(ov),
    };
  }

  const rootComponents: RootComponent[] = arr(root.RootComponents?.RootComponent).map((rc) => ({
    type: Number(rc["@_type"]),
    key: String(rc["@_schemaName"] ?? rc["@_id"] ?? ""),
    behavior: Number(rc["@_behavior"] ?? 0),
  }));

  const missingDependencies: MissingDependency[] = arr(root.MissingDependencies?.MissingDependency).map((md) => ({
    requiredType: String(md.Required?.["@_type"] ?? ""),
    requiredName: String(md.Required?.["@_displayName"] ?? md.Required?.["@_key"] ?? ""),
    requiredSolution: String(md.Required?.["@_solution"] ?? ""),
    dependentType: String(md.Dependent?.["@_type"] ?? ""),
    dependentName: String(md.Dependent?.["@_displayName"] ?? md.Dependent?.["@_key"] ?? ""),
  }));

  const uniqueName = text(root.UniqueName);
  let parentSolutionName: string | null = null;
  if (root.ParentSolution) parentSolutionName = text(root.ParentSolution.UniqueName ?? root.ParentSolution) || null;
  // Default patch naming convention: <Parent>_Patch_<8 hex>. Used only when no explicit parent is present.
  if (!parentSolutionName) {
    const m = /^(.+)_Patch_[0-9a-f]{8,}$/i.exec(uniqueName);
    if (m) parentSolutionName = m[1];
  }

  return {
    uniqueName,
    friendlyName,
    version: text(root.Version),
    managed: text(root.Managed) === "1",
    parentSolutionName,
    publisher,
    rootComponents,
    missingDependencies,
    inventory: [],
    files: [],
  };
}

/** Extract an inventory of notable components from customizations.xml. */
export interface CustomizationsModel {
  inventory: InventoryItem[];
  entities: ParsedEntity[];
  relationships: ParsedRelationship[];
  roles: ParsedRole[];
  fieldProfiles: ParsedFieldProfile[];
  siteMaps: ParsedSiteMap[];
  apps: ParsedApp[];
  references: Reference[];
  /** transient: used to link Workflows/*.json to their metadata, not stored */
  workflowMeta: { id: string; name: string; category: number; stateCode: number; file: string }[];
}

/**
 * Relationship category, modelled on D365 ERD Builder's catFn so both tools classify
 * lookups the same way (audit / ownership / portal / generic / business).
 */
export function relationshipCategory(name: string, referenced: string, attr: string): RelationshipCategory {
  const n = name.toLowerCase(), a = attr.toLowerCase(), rd = referenced.toLowerCase();
  if (["createdby", "modifiedby", "createdonbehalfby", "modifiedonbehalfby"].includes(a)) return "audit";
  if (["owninguser", "owningteam", "owningbusinessunit"].includes(a) || a.startsWith("owner")) return "ownership";
  if (["businessunit", "organization", "team"].includes(rd) || /^(business_unit_|organization_|team_|owner_|lk_|user_)/.test(n)) return "ownership";
  if (/^(adx_|mspp_|msa_)/.test(n)) return "portal";
  if (GENERIC_TABLES.has(rd) || /^(activity_pointer_|transactioncurrency_|fileattachment_|processstage_|sla|bulkdelete|duplicate|principalobjectattribute|import)/.test(n)) return "generic";
  return "business";
}
const GENERIC_TABLES = new Set(["lead", "opportunity", "quote", "invoice", "salesorder", "incident", "site", "campaign", "campaignactivity", "bulkoperation", "sla", "mailbox", "service", "bookableresource", "bookableresourcebooking", "bookableresourcebookingheader", "knowledgebaserecord", "knowledgearticle", "interactionforemail", "recurringappointmentmaster", "activityparty", "processstage", "asyncoperation", "workflow", "transactioncurrency", "fileattachment", "approvalprocess", "approvalstageapproval"]);

const VERBS: [string, string][] = [["appendto", "AppendTo"], ["append", "Append"], ["create", "Create"], ["read", "Read"], ["write", "Write"], ["delete", "Delete"], ["assign", "Assign"], ["share", "Share"]];
/** Privilege names are prv<Verb><entity>; AppendTo is tested before Append (shared prefix). */
export function parsePrivilegeName(name: string): { verb: string; entity: string } | null {
  if (!name || name.slice(0, 3) !== "prv") return null;
  const body = name.slice(3);
  for (const [verb, P] of VERBS) if (body.startsWith(P)) return { verb, entity: body.slice(P.length).toLowerCase() };
  return null;
}
/** Privilege depth is a word (Basic/Local/Deep/Global) or mask number (1/2/4/8; 0 = none). */
export function parsePrivilegeLevel(v: string): AccessLevel {
  const x = v.trim().toLowerCase();
  if (x === "1" || x === "basic" || x === "user") return "user";
  if (x === "2" || x === "local" || x === "businessunit" || x === "bu") return "bu";
  if (x === "4" || x === "deep" || x === "parentchild") return "deep";
  if (x === "8" || x === "global" || x === "organization" || x === "org") return "org";
  return "none";
}
export const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, user: 1, bu: 2, deep: 3, org: 4 };
const permAllowed = (v: unknown) => { const x = String(v ?? "").trim(); return x !== "" && x !== "0" && x.toLowerCase() !== "false"; };
const truthy = (v: string) => /^(1|true|yes)$/i.test(v.trim());

export function parseCustomizationsXml(content: string): CustomizationsModel {
  const root = xml.parse(content)?.ImportExportXml;
  const empty: CustomizationsModel = { inventory: [], entities: [], relationships: [], roles: [], fieldProfiles: [], siteMaps: [], apps: [], references: [], workflowMeta: [] };
  if (!root) return empty;
  const items: InventoryItem[] = [];
  const add = (type: number, key: string, displayName?: string, details?: InventoryItem["details"]) => {
    if (key) items.push({ type, typeName: componentTypeName(type), key, displayName, details });
  };

  const entities = new Map<string, ParsedEntity>();
  for (const e of arr(root.Entities?.Entity)) {
    const logical = text(e.Name).toLowerCase();
    if (!logical) continue;
    const attrs: EntityAttribute[] = [];
    for (const a of arr(e.EntityInfo?.entity?.attributes?.attribute)) {
      const name = (text(a.LogicalName) || text(a.Name)).toLowerCase();
      if (!name) continue;
      const dn = arr(a.displaynames?.displayname)[0];
      const att: EntityAttribute = {
        name, type: text(a.Type), required: text(a.RequiredLevel), display: String(dn?.["@_description"] ?? ""),
      };
      if (text(a.IsCustomField)) att.custom = truthy(text(a.IsCustomField));
      if (text(a.IsSecured)) att.secured = truthy(text(a.IsSecured));
      if (text(a.IsAuditEnabled)) att.audit = truthy(text(a.IsAuditEnabled));
      if (text(a.OptionSetName)) att.optionSet = text(a.OptionSetName);
      if (text(a.MaxLength)) att.maxLength = text(a.MaxLength);
      if (text(a.Format)) att.format = text(a.Format);
      if (att.type.toLowerCase() === "primarykey" || name === `${logical}id` || name === "activityid") att.pk = true;
      attrs.push(att);
    }
    const prev = entities.get(logical);
    if (prev) {
      const have = new Set(prev.attributes.map((x) => x.name));
      for (const x of attrs) if (!have.has(x.name)) prev.attributes.push(x);
    } else {
      const idx = logical.indexOf("_");
      entities.set(logical, { logical, display: String(e.Name?.["@_LocalizedName"] ?? logical), prefix: idx > 0 ? logical.slice(0, idx) : "", attributes: attrs });
    }
  }
  const relationships: ParsedRelationship[] = [];
  const seenRel = new Set<string>();
  for (const r of arr(root.EntityRelationships?.EntityRelationship)) {
    const type = text(r.EntityRelationshipType);
    const referenced = text(r.ReferencedEntityName).toLowerCase(), referencing = text(r.ReferencingEntityName).toLowerCase();
    const attribute = text(r.ReferencingAttributeName).toLowerCase();
    const key = `${referenced}|${referencing}|${attribute}|${type}`;
    if (seenRel.has(key)) continue;
    seenRel.add(key);
    const name = String(r["@_Name"] ?? "");
    relationships.push({ name, type, referenced, referencing, attribute, category: relationshipCategory(name, referenced, attribute) });
  }
  for (const r of relationships) {
    if (r.type !== "OneToMany") continue;
    const att = entities.get(r.referencing)?.attributes.find((x) => x.name === r.attribute);
    if (att) att.targets = [...new Set([...(att.targets ?? []), r.referenced])];
  }
  for (const en of entities.values()) {
    const names = en.attributes.map((a) => a.name);
    add(1, en.logical, en.display, { attributes: names, attributeCount: names.length });
  }

  const roles: ParsedRole[] = [];
  for (const role of arr(root.Roles?.Role)) {
    const name = String(role["@_name"] ?? role["@_id"] ?? "").trim();
    if (!name) continue;
    const privileges: ParsedRole["privileges"] = {};
    for (const rp of arr(role.RolePrivileges?.RolePrivilege)) {
      const pp = parsePrivilegeName(String(rp["@_name"] ?? ""));
      const level = parsePrivilegeLevel(String(rp["@_level"] ?? ""));
      if (!pp || level === "none") continue;
      const cur = (privileges[pp.entity] ??= {});
      if (!cur[pp.verb] || LEVEL_RANK[level] > LEVEL_RANK[cur[pp.verb]]) cur[pp.verb] = level;
    }
    roles.push({ id: String(role["@_id"] ?? ""), name, privileges });
  }
  roles.sort((a, b) => a.name.localeCompare(b.name));

  const fieldProfiles: ParsedFieldProfile[] = [];
  for (const prof of arr(root.FieldSecurityProfiles?.FieldSecurityProfile)) {
    const name = String(prof["@_name"] ?? prof["@_fieldsecurityprofileid"] ?? prof["@_id"] ?? "").trim();
    if (!name) continue;
    const permissions: FieldPermission[] = [];
    for (const fp of arr(prof.FieldPermissions?.FieldPermission)) {
      const entity = String(fp["@_entityname"] ?? "").toLowerCase(), attribute = String(fp["@_attributename"] ?? "").toLowerCase();
      if (!entity || !attribute) continue;
      permissions.push({ entity, attribute, create: permAllowed(fp["@_cancreate"]), read: permAllowed(fp["@_canread"]), update: permAllowed(fp["@_canupdate"]) });
    }
    fieldProfiles.push({ id: String(prof["@_fieldsecurityprofileid"] ?? prof["@_id"] ?? ""), name, permissions });
  }
  fieldProfiles.sort((a, b) => a.name.localeCompare(b.name));

  const workflowMeta: CustomizationsModel["workflowMeta"] = [];
  for (const w of arr(root.Workflows?.Workflow)) {
    const id = guid(w["@_WorkflowId"] ?? w["@_Name"]);
    const category = Number(text(w.Category) || -1), stateCode = Number(text(w.StateCode) || -1);
    add(29, id, w["@_Name"], { category, stateCode, primaryEntity: text(w.PrimaryEntity) });
    if (text(w.JsonFileName)) workflowMeta.push({ id, name: String(w["@_Name"] ?? id), category, stateCode, file: text(w.JsonFileName) });
  }
  // GUID-addressed components that other components point at (forms, views, charts) and connection references.
  const references: Reference[] = [];
  for (const sf of findAll(root, "systemform")) {
    const formId = guid(text(sf.formid));
    if (!formId) continue;
    const table = text(sf.objecttypecode).toLowerCase();
    add(60, formId, text(sf.LocalizedNames?.LocalizedName?.["@_description"]) || text(sf.name) || formId, { table });
    const from = { type: 60, key: formId, name: text(sf.name) || formId };
    if (table && !/^\d+$/.test(table)) references.push({ from, kind: "form-table", to: { type: 1, key: table } });
    for (const l of findAll(sf, "Library")) if (l["@_name"]) references.push({ from, kind: "form-webresource", to: { type: 61, key: webResourceName(String(l["@_name"])) } });
    for (const h of findAll(sf, "Handler")) if (h["@_libraryName"]) references.push({ from, kind: "form-webresource", to: { type: 61, key: webResourceName(String(h["@_libraryName"])) } });
    for (const c of findAll(sf, "control")) if (c["@_datafieldname"] && table && !/^\d+$/.test(table)) references.push({ from, kind: "form-column", to: { type: 2, key: `${table}.${String(c["@_datafieldname"]).toLowerCase()}` } });
    for (const v of findAll(sf, "ViewId")) if (text(v)) references.push({ from, kind: "form-view", to: { type: 26, key: guid(text(v)) } });
  }
  for (const q of findAll(root, "savedquery")) {
    const id = guid(text(q.savedqueryid));
    if (id) add(26, id, text(q.LocalizedNames?.LocalizedName?.["@_description"]) || id, { table: text(q.returnedtypecode).toLowerCase() });
  }
  for (const v of findAll(root, "savedqueryvisualization")) {
    const id = guid(text(v.savedqueryvisualizationid));
    if (id) add(59, id, text(v.name) || id);
  }
  for (const c of findAll(root, "connectionreference")) {
    const logical = String(c["@_connectionreferencelogicalname"] ?? "").toLowerCase();
    if (logical) add(CT_CONNECTION_REFERENCE, logical, text(c.connectionreferencedisplayname) || logical, { connector: text(c.connectorid).split("/").pop() ?? "" });
  }
  // Any remaining $webresource: token (ribbon commands, icons, ...) is a web resource dependency of "customizations.xml".
  const seenWr = new Set(references.filter((r) => r.to.type === 61).map((r) => r.to.key.toLowerCase()));
  for (const m of content.matchAll(/\$webresource:([^"'<>\s&]+)/gi)) {
    const name = webResourceName(m[1]);
    if (!seenWr.has(name.toLowerCase())) { seenWr.add(name.toLowerCase()); references.push({ from: { type: 0, key: "customizations.xml", name: "Ribbon / other customizations" }, kind: "webresource-ref", to: { type: 61, key: name } }); }
  }
  const siteMaps = parseSiteMaps(root), apps = parseApps(root);
  for (const a of apps) add(80, a.uniqueName, a.name);
  for (const r of arr(root.WebResources?.WebResource)) {
    add(61, text(r.Name), text(r.DisplayName), { webResourceType: Number(text(r.WebResourceType) || -1) });
  }
  for (const o of arr(root.optionsets?.optionset)) add(9, String(o["@_Name"] ?? ""), String(o["@_localizedName"] ?? ""));
  for (const r of roles) add(20, r.id.toLowerCase() || r.name, r.name);
  for (const p of fieldProfiles) add(24, p.id.toLowerCase() || p.name, p.name);
  for (const c of arr(root.CanvasApps?.CanvasApp)) add(300, text(c.Name), text(c.DisplayName));
  for (const v of arr(root.EnvironmentVariableDefinitions?.EnvironmentVariableDefinition)) {
    add(380, String(v["@_schemaname"] ?? ""), text(v.displayname?.["@_description"] ?? v.displayname), {
      type: text(v.type),
      hasDefaultValue: text(v.defaultvalue) !== "",
    });
  }
  for (const v of arr(root.EnvironmentVariableValues?.EnvironmentVariableValue)) {
    add(381, String(v["@_schemaname"] ?? ""), undefined, { hasValue: text(v.value) !== "" });
  }
  for (const s of arr(root.SdkMessageProcessingSteps?.SdkMessageProcessingStep)) {
    add(92, String(s["@_SdkMessageProcessingStepId"] ?? s["@_Name"] ?? "").toLowerCase(), String(s["@_Name"] ?? ""), {
      stage: Number(s["@_Stage"] ?? -1),
      mode: Number(s["@_Mode"] ?? -1),
    });
  }
  return { inventory: items, entities: [...entities.values()], relationships, roles, fieldProfiles, siteMaps, apps, references, workflowMeta };
}
