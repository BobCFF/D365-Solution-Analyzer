import JSZip from "jszip";
import { validateParsed } from "@/lib/d365/validate";
import { toCsv } from "@/components/ui";
import { describe, expect, it } from "vitest";
import { analyzeSolution } from "@/lib/d365/analyzer";
import { compareSolutions } from "@/lib/d365/compare";
import { parseSolutionZip } from "@/lib/d365/parser";
import { compareVersions, parseVersion } from "@/lib/d365/version";

const solutionXml = (o: { name: string; version: string; managed?: number; extra?: string; prefix?: string; roots?: string }) => `<?xml version="1.0"?>
<ImportExportXml><SolutionManifest>
<UniqueName>${o.name}</UniqueName><LocalizedNames><LocalizedName description="${o.name} display" languagecode="1033"/></LocalizedNames>
<Version>${o.version}</Version><Managed>${o.managed ?? 0}</Managed>
<Publisher><UniqueName>contoso</UniqueName><CustomizationPrefix>${o.prefix ?? "con"}</CustomizationPrefix><CustomizationOptionValuePrefix>12345</CustomizationOptionValuePrefix></Publisher>
<RootComponents>${o.roots ?? '<RootComponent type="1" schemaName="con_widget" behavior="0"/>'}</RootComponents>
<MissingDependencies>${o.extra ?? ""}</MissingDependencies>
</SolutionManifest></ImportExportXml>`;

const custXml = (attrs: string[]) => `<ImportExportXml><Entities><Entity><Name LocalizedName="Widget">con_widget</Name>
<EntityInfo><entity><attributes>${attrs.map((a) => `<attribute PhysicalName="${a}"><Type>nvarchar</Type><LogicalName>${a}</LogicalName></attribute>`).join("")}</attributes></entity></EntityInfo></Entity></Entities>
<Workflows><Workflow WorkflowId="{ABC}" Name="Old WF"><Category>0</Category></Workflow></Workflows>
<EnvironmentVariableDefinitions><EnvironmentVariableDefinition schemaname="con_url"><type>100000000</type></EnvironmentVariableDefinition></EnvironmentVariableDefinitions>
</ImportExportXml>`;

async function zipOf(sol: string, cust?: string) {
  const z = new JSZip();
  z.file("[Content_Types].xml", "<Types/>");
  z.file("solution.xml", sol);
  if (cust) z.file("customizations.xml", cust);
  return z.generateAsync({ type: "uint8array" });
}

describe("versions", () => {
  it("parses and compares", () => {
    expect(parseVersion("1.0.0.0")).toEqual({ major: 1, minor: 0, build: 0, revision: 0 });
    expect(parseVersion("bad")).toBeNull();
    expect(compareVersions(parseVersion("1.0.1.0")!, parseVersion("1.0.0.5")!)).toBe(1);
  });
});

describe("parser + analyzer", () => {
  it("parses a package and flags issues", async () => {
    const dep = `<MissingDependency><Required key="k" type="Entity" displayName="Account Ext" solution="BaseSol"/><Dependent key="d" type="Form" displayName="Main"/></MissingDependency>`;
    const p = await parseSolutionZip(await zipOf(solutionXml({ name: "Core", version: "1.0.0.0", extra: dep }), custXml(["con_a"])));
    expect(p.uniqueName).toBe("Core");
    expect(p.rootComponents[0]).toMatchObject({ type: 1, key: "con_widget" });
    expect(p.inventory.find((i) => i.type === 1)?.details?.attributes).toEqual(["con_a"]);
    const ids = analyzeSolution(p).map((f) => f.ruleId);
    expect(ids).toEqual(expect.arrayContaining(["DEP001", "WF001", "ENV001", "MAN001"]));
  });

  it("rejects non-solution zips", async () => {
    const z = new JSZip(); z.file("x.txt", "hi");
    await expect(parseSolutionZip(await z.generateAsync({ type: "uint8array" }))).rejects.toThrow(/solution.xml/);
  });

  it("validates patch versioning against the parent", async () => {
    const parent = await parseSolutionZip(await zipOf(solutionXml({ name: "Core", version: "1.0.0.0" }), custXml([])));
    const good = await parseSolutionZip(await zipOf(solutionXml({ name: "Core_Patch_0a1b2c3d", version: "1.0.1.0" }), custXml([])));
    const bad = await parseSolutionZip(await zipOf(solutionXml({ name: "Core_Patch_0a1b2c3d", version: "1.1.0.0" }), custXml([])));
    expect(good.parentSolutionName).toBe("Core");
    expect(analyzeSolution(good, { others: [parent] }).map((f) => f.ruleId)).not.toContain("PAT002");
    expect(analyzeSolution(bad, { others: [parent] }).map((f) => f.ruleId)).toContain("PAT002");
    expect(analyzeSolution(good).map((f) => f.ruleId)).toContain("PAT001");
  });
});

describe("compare", () => {
  it("detects added, removed and changed components", async () => {
    const a = await parseSolutionZip(await zipOf(solutionXml({ name: "S", version: "1.0.0.0" }), custXml(["con_a"])));
    const b = await parseSolutionZip(await zipOf(solutionXml({ name: "S", version: "1.1.0.0", roots: '<RootComponent type="1" schemaName="con_widget" behavior="0"/><RootComponent type="61" schemaName="con_/x.js" behavior="0"/>' }), custXml(["con_a", "con_b"])));
    const d = compareSolutions(a, b);
    expect(d.added.map((x) => x.key)).toContain("con_/x.js");
    expect(d.changed[0].changes.join()).toContain("columns added: con_b");
    expect(d.metadata.find((m) => m.field === "version")).toBeTruthy();
  });
});

describe("schema parsing + rules (0.2.0)", () => {
  const cust = `<ImportExportXml>
<Entities>
 <Entity><Name LocalizedName="Widget">con_widget</Name><EntityInfo><entity><attributes>
  <attribute PhysicalName="con_widgetid"><Type>primarykey</Type><LogicalName>con_widgetid</LogicalName></attribute>
  <attribute PhysicalName="con_owner"><Type>lookup</Type><LogicalName>con_owner</LogicalName><RequiredLevel>required</RequiredLevel><IsCustomField>1</IsCustomField></attribute>
  <attribute PhysicalName="con_secret"><Type>nvarchar</Type><LogicalName>con_secret</LogicalName><IsSecured>1</IsSecured></attribute>
 </attributes></entity></EntityInfo></Entity>
</Entities>
<EntityRelationships>
 <EntityRelationship Name="con_gadget_widget"><EntityRelationshipType>OneToMany</EntityRelationshipType><ReferencedEntityName>con_gadget</ReferencedEntityName><ReferencingEntityName>con_widget</ReferencingEntityName><ReferencingAttributeName>con_owner</ReferencingAttributeName></EntityRelationship>
</EntityRelationships>
<Roles><Role id="{1}" name="Widget User"><RolePrivileges>
 <RolePrivilege name="prvReadcon_widget" level="Global"/><RolePrivilege name="prvAppendTocon_widget" level="Local"/><RolePrivilege name="prvReadcon_missing" level="Basic"/>
</RolePrivileges></Role></Roles>
<FieldSecurityProfiles><FieldSecurityProfile name="P1"><FieldPermissions><FieldPermission entityname="con_widget" attributename="con_nope" canread="4" cancreate="0" canupdate="0"/></FieldPermissions></FieldSecurityProfile></FieldSecurityProfiles>
</ImportExportXml>`;

  it("parses tables, lookups, roles and field profiles", async () => {
    const p = await parseSolutionZip(await zipOf(solutionXml({ name: "Core", version: "1.0.0.0" }), cust));
    expect(p.entities?.[0].attributes.find((a) => a.name === "con_widgetid")?.pk).toBe(true);
    expect(p.entities?.[0].attributes.find((a) => a.name === "con_owner")?.targets).toEqual(["con_gadget"]);
    expect(p.relationships?.[0].category).toBe("business");
    expect(p.roles?.[0].privileges.con_widget).toEqual({ read: "org", appendto: "bu" });
    expect(p.fieldProfiles?.[0].permissions[0]).toMatchObject({ attribute: "con_nope", read: true, create: false });
  });

  it("flags missing custom tables, role privileges and field-security gaps", async () => {
    const p = await parseSolutionZip(await zipOf(solutionXml({ name: "Core", version: "1.0.0.0" }), cust));
    const f = analyzeSolution(p);
    const ids = f.map((x) => x.ruleId);
    expect(ids).toEqual(expect.arrayContaining(["REL001", "SEC001", "FLD001", "FLD003"]));
    expect(f.find((x) => x.ruleId === "REL001")?.componentKey).toBe("con_gadget");
    // once the owning solution is loaded, the dependency findings go away
    const base = await parseSolutionZip(await zipOf(solutionXml({ name: "Base", version: "1.0.0.0" }), cust.replace("con_widget", "con_gadget").replace(/con_widget/g, "con_gadget")));
    expect(analyzeSolution(p, { others: [base] }).map((x) => x.ruleId)).not.toContain("REL001");
  });

  it("reports breaking column type changes in compare", async () => {
    const a = await parseSolutionZip(await zipOf(solutionXml({ name: "S", version: "1.0.0.0" }), cust));
    const b = await parseSolutionZip(await zipOf(solutionXml({ name: "S", version: "1.1.0.0" }), cust.replace("<Type>nvarchar</Type>", "<Type>int</Type>")));
    const d = compareSolutions(a, b);
    expect(d.columns).toContainEqual({ table: "con_widget", column: "con_secret", change: "type", from: "nvarchar", to: "int" });
  });
});

describe("input hardening", () => {
  it("rejects malformed parsed payloads", () => {
    expect(() => validateParsed(null)).toThrow();
    expect(() => validateParsed({ uniqueName: "x", friendlyName: "x", version: "1.0.0.0", managed: "no" })).toThrow(/managed/);
    expect(() => validateParsed({ uniqueName: "", friendlyName: "x", version: "1", managed: true, rootComponents: [], missingDependencies: [], inventory: [], files: [] })).toThrow(/uniqueName/);
  });
  it("neutralises CSV formula injection", () => {
    expect(toCsv([["=HYPERLINK(\"x\")", "a,b"]])).toBe(`"'=HYPERLINK(""x"")","a,b"`);
  });
});
