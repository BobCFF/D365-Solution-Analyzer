import JSZip from "jszip";
import { analyzeSelection, compareSets } from "@/lib/d365/comparison";
import { planImportOrder } from "@/lib/d365/dependencies";
import { diffFlows, layoutFlow } from "@/lib/d365/flowLayout";
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

describe("dependencies, navigation and flows (0.3.0)", () => {
  const sitemap = `<ImportExportXml>
<Entities><Entity><Name>con_widget</Name><EntityInfo><entity><attributes><attribute><Type>nvarchar</Type><LogicalName>con_name</LogicalName></attribute></attributes></entity></EntityInfo>
 <FormXml><forms type="main"><systemform><formid>{AAAAAAAA-0000-0000-0000-000000000001}</formid><objecttypecode>con_widget</objecttypecode>
  <form><formLibraries><Library name="con_/js/widget.js" libraryUniqueId="{1}"/></formLibraries><tabs><tab><columns><column><sections><section><rows><row><cell><control id="c1" datafieldname="con_ghost"/></cell></row></rows></section></sections></column></columns></tab></tabs></form></systemform></forms></FormXml></Entity></Entities>
<SiteMap><SiteMap><Area Id="Area1" Icon="$webresource:con_/img/area.svg"><Titles><Title LCID="1033" Title="Main"/></Titles>
 <Group Id="G1"><Titles><Title LCID="1033" Title="Grp"/></Titles>
  <SubArea Id="S1" Entity="con_widget"><Titles><Title LCID="1033" Title="Widgets"/></Titles></SubArea>
  <SubArea Id="S1" Entity="con_gadget"><Titles><Title LCID="1033" Title="Gadgets"/></Titles></SubArea>
  <SubArea Id="S3" Url="$webresource:con_/pages/home.html"><Titles><Title LCID="1033" Title="Home"/></Titles></SubArea>
  <SubArea Id="S4" Entity="account"><Titles><Title LCID="1033" Title="Accounts"/></Titles></SubArea>
 </Group></Area></SiteMap></SiteMap>
<AppModules><AppModule><UniqueName>con_app</UniqueName><AppModuleComponents><AppModuleComponent type="1" schemaName="con_widget"/><AppModuleComponent type="1" schemaName="con_other"/></AppModuleComponents></AppModule></AppModules>
</ImportExportXml>`;

  const flowJson = JSON.stringify({ properties: {
    connectionReferences: { shared_cds: { connection: { connectionReferenceLogicalName: "con_dataverse" }, api: { name: "shared_commondataserviceforapps" } } },
    definition: {
      triggers: { When_row_added: { type: "OpenApiConnectionWebhook", inputs: { host: { apiId: "/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps", connectionName: "shared_cds", operationId: "SubscribeWebhookTrigger" } } } },
      actions: {
        Check: { type: "If", runAfter: {}, expression: { equals: ["@parameters('Region (con_region)')", "x"] },
          actions: { Child: { type: "Workflow", runAfter: {}, inputs: { host: { workflowReferenceName: "BBBBBBBB-0000-0000-0000-000000000009" } } } },
          else: { actions: { Notify: { type: "OpenApiConnection", runAfter: {}, inputs: { host: { apiId: "/providers/Microsoft.PowerApps/apis/shared_office365", connectionName: "shared_cds", operationId: "SendEmailV2" }, parameters: { body: "secret@@" } } } } } },
        Done: { type: "Compose", runAfter: { Check: ["Succeeded", "Failed"] }, inputs: "x" },
      },
    },
  } });

  async function pkg() {
    const z = new JSZip();
    z.file("[Content_Types].xml", "<Types/>");
    z.file("solution.xml", solutionXml({ name: "Nav", version: "1.0.0.0", roots: '<RootComponent type="1" schemaName="con_widget" behavior="0"/>' }));
    z.file("customizations.xml", sitemap.replace("</ImportExportXml>", `<Workflows><Workflow WorkflowId="{CCCCCCCC-0000-0000-0000-000000000001}" Name="Notify flow"><Category>5</Category><StateCode>0</StateCode><JsonFileName>/Workflows/Notify-CCCCCCCC-0000-0000-0000-000000000001.json</JsonFileName></Workflow></Workflows></ImportExportXml>`));
    z.file("Workflows/Notify-CCCCCCCC-0000-0000-0000-000000000001.json", flowJson);
    return parseSolutionZip(await z.generateAsync({ type: "uint8array" }));
  }

  it("models navigation, apps and flows without keeping expressions", async () => {
    const p = await pkg();
    expect(p.siteMaps?.[0].areas[0].groups[0].subAreas).toHaveLength(4);
    expect(p.apps?.[0].components).toHaveLength(2);
    const fl = p.flows?.[0];
    expect(fl?.nodes.map((n) => n.kind)).toEqual(expect.arrayContaining(["trigger", "condition", "childflow", "connector", "data"]));
    expect(fl?.connectionRefs).toEqual(["con_dataverse"]);
    expect(fl?.envVars).toEqual(["con_region"]);
    expect(fl?.childFlows).toEqual(["bbbbbbbb-0000-0000-0000-000000000009"]);
    expect(JSON.stringify(fl)).not.toContain("secret@@");
    expect(fl?.nodes.find((n) => n.name === "Done")?.runAfter[0].states).toEqual(["Succeeded", "Failed"]);
  });

  it("finds missing dependencies in navigation, forms, apps and flows", async () => {
    const p = await pkg();
    const f = analyzeSolution(p);
    const byId = (id: string) => f.filter((x) => x.ruleId === id);
    expect(byId("NAV001").map((x) => x.componentKey)).toEqual(["con_gadget"]);      // nav -> missing custom table
    expect(byId("NAV002").map((x) => x.componentKey).sort()).toEqual(["con_/img/area.svg", "con_/pages/home.html"]);
    expect(byId("NAV003")).toHaveLength(1);                                          // duplicate SubArea Id S1
    expect(byId("DEP103").map((x) => x.componentKey)).toEqual(["con_/js/widget.js"]); // form library
    expect(byId("DEP102").map((x) => x.componentKey)).toEqual(["con_widget.con_ghost"]); // form control on absent column
    expect(byId("DEP101").map((x) => x.componentKey)).toEqual(["con_other"]);         // app component
    expect(byId("DEP105")).toHaveLength(1);                                          // child flow
    expect(byId("DEP106").map((x) => x.componentKey)).toEqual(["con_dataverse"]);
    expect(byId("DEP107").map((x) => x.componentKey)).toEqual(["con_region"]);
    expect(byId("FLOW002")).toHaveLength(1);
    expect(byId("NAV005")).toHaveLength(1);                                          // app without site map
  });
});

describe("flow layout, flow diff, comparison and import order", () => {
  it("lays out nested flows without overlapping siblings", async () => {
    const p = await (async () => { const z = new JSZip(); z.file("[Content_Types].xml", "<Types/>"); z.file("solution.xml", solutionXml({ name: "F", version: "1.0.0.0" })); z.file("customizations.xml", "<ImportExportXml><Workflows><Workflow WorkflowId=\"{CCCCCCCC-0000-0000-0000-000000000001}\" Name=\"f\"><Category>5</Category><JsonFileName>/Workflows/f-CCCCCCCC-0000-0000-0000-000000000001.json</JsonFileName></Workflow></Workflows></ImportExportXml>"); z.file("Workflows/f-CCCCCCCC-0000-0000-0000-000000000001.json", JSON.stringify({ properties: { definition: { triggers: { T: { type: "Request", kind: "Button" } }, actions: { A: { type: "Compose", runAfter: {} }, B: { type: "Compose", runAfter: { A: ["Succeeded"] } }, C: { type: "Compose", runAfter: { A: ["Failed"] } }, If1: { type: "If", runAfter: { B: ["Succeeded"] }, actions: { Y: { type: "Compose", runAfter: {} } }, else: { actions: { N: { type: "Compose", runAfter: {} } } } } } } } })); return parseSolutionZip(await z.generateAsync({ type: "uint8array" })); })();
    const fl = p.flows![0];
    const lay = layoutFlow(fl);
    expect(lay.nodes.size).toBe(fl.nodes.length);
    const boxes = [...lay.nodes.values()].filter((n) => !n.container || true);
    const leaf = boxes.filter((n) => !n.container);
    for (let i = 0; i < leaf.length; i++) for (let j = i + 1; j < leaf.length; j++) {
      const a = leaf[i], b = leaf[j];
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
    }
    expect(lay.lanes.map((l) => l.label).sort()).toEqual(["If no", "If yes"]);
    expect(lay.edges.find((e) => e.from === "/A" && e.to === "/C")?.fault).toBe(true);
    // diff: drop C, change B
    const v2 = { ...fl, nodes: fl.nodes.filter((n) => n.id !== "/C").map((n) => (n.id === "/B" ? { ...n, operation: "x" } : n)) };
    const d = diffFlows(fl, v2);
    expect(d.status.get("/C")).toBe("new");
    expect(d.status.get("/B")).toBe("changed");
    expect(d.counts).toEqual({ new: 1, deleted: 0, changed: 1 });
  });

  it("compares solutions Salesforce-style and reports deploy readiness", async () => {
    const mk = async (ver: string, cust: string, roots: string) => parseSolutionZip(await zipOf(solutionXml({ name: "S", version: ver, roots }), cust));
    const nav = (id: string, ent: string) => `<ImportExportXml><Entities><Entity><Name>con_widget</Name><EntityInfo><entity><attributes><attribute><Type>nvarchar</Type><LogicalName>con_a</LogicalName></attribute></attributes></entity></EntityInfo></Entity></Entities><SiteMap><SiteMap><Area Id="A"><Group Id="G"><SubArea Id="${id}" Entity="${ent}"/></Group></Area></SiteMap></SiteMap></ImportExportXml>`;
    const roots = '<RootComponent type="1" schemaName="con_widget" behavior="0"/><RootComponent type="62" id="{11111111-0000-0000-0000-000000000000}" behavior="0"/>';
    const src = await mk("1.1.0.0", nav("S1", "con_gadget"), roots);
    const tgt = await mk("1.0.0.0", nav("S0", "con_widget"), roots);
    const c = compareSets(src, tgt);
    expect(c.counts.new).toBeGreaterThan(0);
    expect(c.rows.find((r) => r.key.endsWith("/S1"))?.status).toBe("new");
    expect(c.rows.find((r) => r.key.endsWith("/S0"))?.status).toBe("deleted");
    const sel = [...c.byId.values()].find((r) => r.key.endsWith("/S1"))!;
    const rep = analyzeSelection([sel.id], src, tgt, c);
    expect(rep.missing.map((m) => m.ref.to.key)).toEqual(["con_gadget"]);   // nav item needs a table that exists nowhere
    // once the target defines the table, the dependency is satisfied
    const tgt2 = await mk("1.0.0.0", nav("S0", "con_widget").replace("con_widget</Name>", "con_widget</Name>").replace("</Entities>", "<Entity><Name>con_gadget</Name></Entity></Entities>"), roots);
    expect(analyzeSelection([sel.id], src, tgt2, compareSets(src, tgt2)).missing).toEqual([]);
  });

  it("plans import order from cross-solution dependencies", async () => {
    const base = await parseSolutionZip(await zipOf(solutionXml({ name: "Base", version: "1.0.0.0", roots: '<RootComponent type="1" schemaName="con_widget" behavior="0"/>' }), custXml(["con_a"])));
    const ext = await parseSolutionZip(await zipOf(solutionXml({ name: "Ext", version: "1.0.0.0", roots: '<RootComponent type="62" id="{22222222-0000-0000-0000-000000000000}" behavior="0"/>' }), `<ImportExportXml><SiteMap><SiteMap><Area Id="A"><Group Id="G"><SubArea Id="S" Entity="con_widget"/></Group></Area></SiteMap></SiteMap></ImportExportXml>`));
    const plan = planImportOrder([ext, base]);
    expect(plan.order.map((o) => o.solution)).toEqual(["Base", "Ext"]);
    expect(plan.order[1].after).toEqual(["Base"]);
    expect(plan.cycles).toEqual([]);
  });
});
