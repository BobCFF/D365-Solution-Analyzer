import { componentTypeName } from "./componentTypes";
import { resolveReferences } from "./dependencies";
import { parseSolutionRef } from "./missingDeps";
import type { Finding, ParsedSolution, Severity } from "./types";
import { compareVersions, parseVersion } from "./version";

export interface AnalyzeContext {
  /** Other solutions already loaded in the database (used for patch and layering checks). */
  others?: ParsedSolution[];
}

const solName = (md: ParsedSolution["missingDependencies"][number]) => md.requiredSolutionName ?? parseSolutionRef(md.requiredSolution).name;
const sameKey = (a: { type: number; key: string }, b: { type: number; key: string }) =>
  a.type === b.type && a.key.toLowerCase() === b.key.toLowerCase();

export function analyzeSolution(sol: ParsedSolution, ctx: AnalyzeContext = {}): Finding[] {
  const f: Finding[] = [];
  const others = ctx.others ?? [];
  const isPatch = sol.parentSolutionName !== null;

  // --- Package structure -------------------------------------------------
  if (!sol.files.includes("customizations.xml")) {
    f.push({ ruleId: "PKG001", severity: "error", title: "customizations.xml missing",
      detail: "A Dataverse solution package must contain customizations.xml, solution.xml and [Content_Types].xml.",
      remediation: "Re-export the solution from the source environment (or `pac solution pack`) rather than zipping files manually." });
  }
  if (sol.files.length && !sol.files.includes("[Content_Types].xml")) {
    f.push({ ruleId: "PKG002", severity: "error", title: "[Content_Types].xml missing",
      detail: "The package is missing [Content_Types].xml and will fail import.",
      remediation: "Re-export the solution or rebuild it with the Power Platform CLI (`pac solution pack`)." });
  }

  // --- Version -----------------------------------------------------------
  const ver = parseVersion(sol.version);
  if (!ver) {
    f.push({ ruleId: "VER001", severity: "error", title: "Invalid solution version",
      detail: `Version "${sol.version}" is not in major.minor.build.revision format.`,
      remediation: "Set a version such as 1.0.0.0 in the source environment." });
  }

  // --- Publisher ---------------------------------------------------------
  const pub = sol.publisher;
  if (!pub) {
    f.push({ ruleId: "PUB001", severity: "error", title: "Publisher missing", detail: "solution.xml has no Publisher element." });
  } else {
    if (/^(default|microsoftdynamics)/i.test(pub.uniqueName) || /^DefaultPublisher/i.test(pub.uniqueName)) {
      f.push({ ruleId: "PUB002", severity: "warning", title: "Default publisher in use",
        detail: `Publisher "${pub.uniqueName}" looks like an environment default publisher.`,
        remediation: "Microsoft recommends creating a custom publisher with your own prefix for every solution you ship, so components are owned consistently across environments." });
    }
    if (!pub.customizationPrefix || pub.customizationPrefix.toLowerCase() === "new") {
      f.push({ ruleId: "PUB003", severity: "warning", title: "Publisher prefix missing or 'new'",
        detail: `Customization prefix is "${pub.customizationPrefix || "(empty)"}".`,
        remediation: "Use a distinct 2-8 character prefix to avoid name collisions with other publishers' components." });
    }
    const ov = pub.customizationOptionValuePrefix;
    if (ov !== null && (ov < 10000 || ov > 99999)) {
      f.push({ ruleId: "PUB004", severity: "warning", title: "Option value prefix out of range",
        detail: `CustomizationOptionValuePrefix ${ov} is outside the supported range 10000-99999.` });
    }
    for (const it of sol.inventory.filter((i) => i.type === 1)) {
      const idx = it.key.indexOf("_");
      if (idx > 0 && pub.customizationPrefix && it.key.slice(0, idx) !== pub.customizationPrefix.toLowerCase()) {
        f.push({ ruleId: "PUB005", severity: "info", title: "Table owned by a different publisher",
          detail: `Table "${it.key}" does not use this solution's publisher prefix "${pub.customizationPrefix}".`,
          remediation: "Ensure the owning solution is installed first, or exclude the table / use 'do not include subcomponents'.",
          componentKey: it.key });
      }
    }
  }

  // --- Managed vs unmanaged ---------------------------------------------
  if (!sol.managed) {
    f.push({ ruleId: "MAN001", severity: "info", title: "Unmanaged solution",
      detail: "Unmanaged solutions are for development. Importing into test/production merges changes into the Active layer and cannot be cleanly uninstalled.",
      remediation: "Export as managed for deployment to non-development environments." });
  }

  // --- Missing dependencies ---------------------------------------------
  for (const md of sol.missingDependencies) {
    f.push({ ruleId: "DEP001", severity: "error", title: "Missing dependency",
      detail: `${md.dependentName || "A component"} (${md.dependentType}) requires ${md.requiredName} (${md.requiredType})${md.requiredSolution ? ` from solution "${md.requiredSolution}"` : ""}, which is not in the solution or target.`,
      remediation: md.requiredSolution
        ? `Import solution "${md.requiredSolution}" into the target first, or add the required component to this solution.`
        : "Add the required component to the solution (Add required components) or install the solution that provides it.",
      componentKey: md.requiredName, ...(solName(md) ? { solutions: [solName(md)] } : {}) });
  }

  // --- Duplicate root components ----------------------------------------
  const seen = new Set<string>();
  for (const rc of sol.rootComponents) {
    const k = `${rc.type}:${rc.key.toLowerCase()}`;
    if (seen.has(k)) {
      f.push({ ruleId: "DUP001", severity: "warning", title: "Duplicate root component",
        detail: `${componentTypeName(rc.type)} "${rc.key}" is listed more than once in RootComponents.`, componentKey: rc.key });
    }
    seen.add(k);
  }

  // --- Environment variables --------------------------------------------
  const defs = sol.inventory.filter((i) => i.type === 380);
  const vals = new Set(sol.inventory.filter((i) => i.type === 381).map((i) => i.key.toLowerCase()));
  for (const d of defs) {
    if (!d.details?.hasDefaultValue && !vals.has(d.key.toLowerCase())) {
      f.push({ ruleId: "ENV001", severity: "warning", title: "Environment variable has no value",
        detail: `"${d.key}" has no default or current value; import will prompt for it or fail in automated pipelines.`,
        remediation: "Supply values with a deployment settings file (`pac solution import --settings-file`) or the pipeline's connection/variable mapping.",
        componentKey: d.key });
    }
  }
  if (vals.size) {
    f.push({ ruleId: "ENV002", severity: "info", title: "Environment variable values included in solution",
      detail: `${vals.size} environment variable value(s) are packaged and will overwrite target values.`,
      remediation: "Prefer per-environment values via deployment settings; never ship secrets in solution files." });
  }

  // --- Legacy processes ---------------------------------------------------
  const legacy = sol.inventory.filter((i) => i.type === 29 && (i.details?.category === 0 || i.details?.category === 1));
  if (legacy.length) {
    f.push({ ruleId: "WF001", severity: "warning", title: "Classic workflows / dialogs present",
      detail: `${legacy.length} classic workflow or dialog process(es) found: ${legacy.slice(0, 5).map((l) => l.displayName ?? l.key).join(", ")}.`,
      remediation: "Microsoft has deprecated classic workflows and dialogs; migrate to Power Automate cloud flows." });
  }

  // --- Patches ------------------------------------------------------------
  if (isPatch) {
    const parent = others.filter((o) => o.uniqueName === sol.parentSolutionName).sort((a, b) => cmp(b, a))[0];
    if (!parent) {
      f.push({ ruleId: "PAT001", severity: "warning", title: "Parent solution not loaded",
        detail: `This is a patch of "${sol.parentSolutionName}", which is not loaded, so version and layering checks were skipped.`,
        remediation: "Load the parent solution (and any earlier patches) to enable the full patch checks. The parent must exist in the target before a patch is imported.", solutions: [sol.parentSolutionName!] });
    } else {
      const pv = parseVersion(parent.version);
      if (ver && pv) {
        if (ver.major !== pv.major || ver.minor !== pv.minor) {
          f.push({ ruleId: "PAT002", severity: "error", title: "Patch major.minor differs from parent",
            detail: `Patch ${sol.version} must keep the parent's major.minor (${pv.major}.${pv.minor}); only build/revision may increase.`,
            remediation: "Create the patch from the parent in the source environment (Clone a patch) so the version is assigned correctly. To change major/minor, clone the solution instead.", solutions: [parent.uniqueName] });
        } else if (compareVersions(ver, pv) <= 0) {
          f.push({ ruleId: "PAT003", severity: "error", title: "Patch version not higher than parent",
            detail: `Patch ${sol.version} is not greater than parent ${parent.version}.`,
            remediation: "Patch build/revision numbers must increase over the parent.", solutions: [parent.uniqueName] });
        }
      }
      if (parent.managed !== sol.managed) {
        f.push({ ruleId: "PAT004", severity: "error", title: "Patch and parent managed state differ",
          detail: `Parent is ${parent.managed ? "managed" : "unmanaged"} but patch is ${sol.managed ? "managed" : "unmanaged"}.`, solutions: [parent.uniqueName] });
      }
    }
    for (const rc of sol.rootComponents.filter((r) => r.type === 1 && r.behavior === 0)) {
      f.push({ ruleId: "PAT005", severity: "info", title: "Patch includes all subcomponents of a table",
        detail: `Table "${rc.key}" is included with all subcomponents; patches are intended to carry only changed components.`,
        remediation: "Add only the changed subcomponents (use 'Select components') to keep the patch small and safe.", componentKey: rc.key });
    }
  }

  // --- Cross-solution layering overlaps ---------------------------------
  for (const o of others) {
    if (o.uniqueName === sol.uniqueName) continue;
    const related = o.parentSolutionName === sol.uniqueName || sol.parentSolutionName === o.uniqueName ||
      (o.parentSolutionName !== null && o.parentSolutionName === sol.parentSolutionName);
    if (related || o.managed !== sol.managed) continue;
    const shared = sol.rootComponents.filter((rc) => o.rootComponents.some((x) => sameKey(rc, x)));
    if (shared.length) {
      f.push({ ruleId: "LAY001", severity: "warning", title: `Overlaps with solution "${o.uniqueName}"`,
        detail: `${shared.length} root component(s) are also in "${o.uniqueName}": ${shared.slice(0, 5).map((s) => `${componentTypeName(s.type)} ${s.key}`).join("; ")}${shared.length > 5 ? "; ..." : ""}.`,
        remediation: "For managed solutions the last-imported solution wins at the top of the layer stack. Confirm import order, or move shared components into a common base solution.", solutions: [o.uniqueName] });
    }
  }

  f.push(...schemaRules(sol, others));
  f.push(...dependencyRules(sol, others));
  f.push(...navigationRules(sol));
  f.push(...flowRules(sol));
  return f;
}

/** Rules that need the parsed schema (tables, relationships, security). Skipped silently on 0.1.0-era rows. */
function schemaRules(sol: ParsedSolution, others: ParsedSolution[]): Finding[] {
  const f: Finding[] = [];
  const entities = sol.entities ?? [];
  if (!entities.length && !(sol.roles?.length) && !(sol.fieldProfiles?.length)) return f;

  const local = new Map(entities.map((e) => [e.logical, e]));
  const elsewhere = new Set(others.flatMap((o) => (o.entities ?? []).map((e) => e.logical)));
  // Standard/system tables have no publisher prefix and ship with the platform; only custom tables can be "missing".
  const missingCustom = (name: string) => name.includes("_") && !local.has(name) && !elsewhere.has(name);

  // Relationships whose other end is a custom table that isn't packaged or loaded.
  const reported = new Set<string>();
  for (const r of sol.relationships ?? []) {
    for (const end of [r.referenced, r.referencing]) {
      if (missingCustom(end) && !reported.has(`${r.name}|${end}`)) {
        reported.add(`${r.name}|${end}`);
        f.push({ ruleId: "REL001", severity: "warning", title: "Relationship points to a table not in the solution",
          detail: `Relationship "${r.name}" (${r.referencing}.${r.attribute} -> ${r.referenced}) uses custom table "${end}", which is neither in this solution nor in any other loaded solution.`,
          remediation: `Import the solution that owns "${end}" first, or add the table to this solution (as a shell if you only need the reference).`,
          componentKey: end });
      }
    }
  }

  // Security role privileges on custom tables that aren't packaged.
  const roleMiss = new Map<string, Set<string>>();
  for (const role of sol.roles ?? []) {
    for (const t of Object.keys(role.privileges)) {
      if (missingCustom(t)) (roleMiss.get(t) ?? roleMiss.set(t, new Set()).get(t)!).add(role.name);
    }
  }
  for (const [t, roles] of roleMiss) {
    f.push({ ruleId: "SEC001", severity: "warning", title: "Security role grants privileges on a table not in the solution",
      detail: `${roles.size} role(s) (${[...roles].slice(0, 3).join(", ")}${roles.size > 3 ? ", ..." : ""}) have privileges on "${t}".`,
      remediation: "Import the solution that defines the table before this one, otherwise the role import fails or silently drops those privileges.",
      componentKey: t });
  }

  // Field security profiles.
  const securedCovered = new Set<string>();
  for (const p of sol.fieldProfiles ?? []) {
    for (const fp of p.permissions) {
      securedCovered.add(`${fp.entity}.${fp.attribute}`);
      const ent = local.get(fp.entity);
      if (ent && !ent.attributes.some((a) => a.name === fp.attribute)) {
        f.push({ ruleId: "FLD001", severity: "warning", title: "Field permission references an unknown column",
          detail: `Profile "${p.name}" grants access to ${fp.entity}.${fp.attribute}, but that column is not in the solution's ${fp.entity} definition.`,
          componentKey: `${fp.entity}.${fp.attribute}` });
      } else if (ent && ent.attributes.find((a) => a.name === fp.attribute)?.secured === false) {
        f.push({ ruleId: "FLD002", severity: "info", title: "Field permission on a column that is not secured",
          detail: `${fp.entity}.${fp.attribute} is not marked as secured, so profile "${p.name}" has no effect on it.`,
          componentKey: `${fp.entity}.${fp.attribute}` });
      }
    }
  }
  for (const e of entities) {
    for (const a of e.attributes) {
      if (a.secured && !securedCovered.has(`${e.logical}.${a.name}`)) {
        f.push({ ruleId: "FLD003", severity: "info", title: "Secured column not covered by a profile in this solution",
          detail: `${e.logical}.${a.name} is secured, but no field security profile in this solution grants access to it.`,
          remediation: "Ensure a profile that grants access is deployed, or non-admin users will lose access to the data.",
          componentKey: `${e.logical}.${a.name}` });
      }
    }
  }

  // Custom columns owned by another publisher.
  const prefix = sol.publisher?.customizationPrefix?.toLowerCase();
  if (prefix) {
    for (const e of entities) {
      if (e.prefix !== prefix) continue; // only audit tables this publisher owns
      const foreign = e.attributes.filter((a) => a.custom && a.name.includes("_") && !a.name.startsWith(`${prefix}_`));
      if (foreign.length) {
        f.push({ ruleId: "ATT001", severity: "info", title: "Table contains columns from another publisher",
          detail: `${e.logical} has ${foreign.length} column(s) not using prefix "${prefix}": ${foreign.slice(0, 4).map((a) => a.name).join(", ")}.`,
          componentKey: e.logical });
      }
    }
  }
  return f;
}

const DEP_RULE: Record<number, { id: string; title: string; severity: Severity }> = {
  1: { id: "DEP101", title: "Missing table", severity: "error" },
  2: { id: "DEP102", title: "Missing column", severity: "error" },
  61: { id: "DEP103", title: "Missing web resource", severity: "error" },
  80: { id: "DEP104", title: "Missing model-driven app", severity: "error" },
  29: { id: "DEP105", title: "Missing child flow", severity: "error" },
  9001: { id: "DEP106", title: "Missing connection reference", severity: "warning" },
  380: { id: "DEP107", title: "Missing environment variable definition", severity: "warning" },
};
const NAV_RULE: Record<number, { id: string; title: string }> = {
  1: { id: "NAV001", title: "Navigation points to a missing table" },
  61: { id: "NAV002", title: "Navigation uses a missing web resource" },
};
const NOT_DEP = new Set(["role-table", "lookup-target", "column-table"]); // covered by SEC001 / REL001

/**
 * Reference-graph based missing-dependency detection. Only components we are confident are required and absent
 * (custom tables/columns, web resources, flows, apps, env vars, connection references) are reported as problems;
 * GUID-addressed views/forms/roles that might be system components are summarised as "verify in target".
 */
function dependencyRules(sol: ParsedSolution, others: ParsedSolution[]): Finding[] {
  const out: Finding[] = [];
  const resolved = resolveReferences(sol, others).filter((r) => !NOT_DEP.has(r.ref.kind));
  const group = new Map<string, typeof resolved>();
  for (const r of resolved.filter((x) => x.status === "missing")) {
    const k = `${r.ref.to.type}:${r.ref.to.key.toLowerCase()}`;
    (group.get(k) ?? group.set(k, []).get(k)!).push(r);
  }
  for (let rs of group.values()) {
    // the catch-all "$webresource:" scan duplicates specific owners; keep it only when nothing more specific exists
    if (rs.some((r) => r.ref.kind !== "webresource-ref")) rs = rs.filter((r) => r.ref.kind !== "webresource-ref");
    const to = rs[0].ref.to;
    const navOnly = rs.every((r) => r.ref.kind.startsWith("nav-"));
    const base = DEP_RULE[to.type] ?? { id: "DEP199", title: "Missing component", severity: "error" as Severity };
    const nav = navOnly ? NAV_RULE[to.type] : undefined;
    const who = [...new Set(rs.map((r) => `${componentTypeName(r.ref.from.type)} ${r.ref.from.name || r.ref.from.key}${r.ref.detail ? ` (${r.ref.detail})` : ""}`))];
    out.push({
      ruleId: nav?.id ?? base.id, severity: base.severity, title: nav?.title ?? base.title,
      detail: `${componentTypeName(to.type)} "${to.key}" is required by ${who.slice(0, 4).join("; ")}${who.length > 4 ? `; +${who.length - 4} more` : ""}, but it is not in this solution or any loaded solution.`,
      remediation: to.type === 9001 || to.type === 380
        ? "Include it in the solution (Add existing), or make sure it exists in the target before import; supply values with a deployment settings file."
        : "Add the component to this solution (Add required objects), or import the solution that provides it first. A missing dependency blocks import of managed solutions.",
      componentKey: to.key,
    });
  }
  const unverifiable = resolved.filter((r) => r.status === "unverifiable");
  if (unverifiable.length) {
    const byType = new Map<number, number>();
    for (const r of unverifiable) byType.set(r.ref.to.type, (byType.get(r.ref.to.type) ?? 0) + 1);
    out.push({ ruleId: "DEP108", severity: "info", title: "References to components outside the package",
      detail: `${unverifiable.length} reference(s) point at components not in the package and cannot be verified offline: ${[...byType].map(([t, n]) => `${n} ${componentTypeName(t)}`).join(", ")}. They may be system components.`,
      remediation: "Check the Dependencies tab, and confirm these exist in the target environment (or add them to the solution)." });
  }
  return out;
}

function navigationRules(sol: ParsedSolution): Finding[] {
  const out: Finding[] = [];
  const roles = sol.roles ?? [];
  for (const sm of sol.siteMaps ?? []) {
    const ids = new Map<string, number>();
    const bump = (id: string) => id && ids.set(id, (ids.get(id) ?? 0) + 1);
    for (const a of sm.areas) {
      bump(a.id);
      if (!a.groups.some((g) => g.subAreas.length)) {
        out.push({ ruleId: "NAV006", severity: "warning", title: "Empty navigation area", detail: `Area "${a.title}" in "${sm.name}" has no sub areas and will show nothing.`, componentKey: a.id });
      }
      for (const g of a.groups) {
        bump(g.id);
        for (const s of g.subAreas) {
          bump(s.id);
          if (!s.entity && !s.url && !s.dashboard) {
            out.push({ ruleId: "NAV007", severity: "warning", title: "Sub area has no target", detail: `"${a.title} › ${g.title} › ${s.title}" has no Entity, Url or DefaultDashboard.`, componentKey: s.id });
          }
          if (s.entity && roles.length && !roles.some((r) => r.privileges[s.entity!]?.read)) {
            out.push({ ruleId: "NAV004", severity: "info", title: "No role in this solution can read a navigation table",
              detail: `"${a.title} › ${g.title} › ${s.title}" opens ${s.entity}, but none of the ${roles.length} role(s) in this solution grant Read on it - users without another role will not see the item.`,
              remediation: "Grant Read on the table in a deployed security role, or confirm existing roles in the target cover it.", componentKey: s.id });
          }
        }
      }
    }
    for (const [id, n] of ids) {
      if (n > 1) out.push({ ruleId: "NAV003", severity: "error", title: "Duplicate navigation Id", detail: `Id "${id}" is used ${n} times in site map "${sm.name}". Area, Group and SubArea Ids must be unique.`, componentKey: id });
    }
  }
  for (const app of sol.apps ?? []) {
    if (!app.components.some((c) => c.type === 62)) {
      out.push({ ruleId: "NAV005", severity: "warning", title: "App has no site map", detail: `Model-driven app "${app.name}" does not include a site map component, so it will show no navigation after import.`, componentKey: app.uniqueName });
    }
  }
  return out;
}

function flowRules(sol: ParsedSolution): Finding[] {
  const out: Finding[] = [];
  for (const fl of sol.flows ?? []) {
    if (!fl.nodes.some((n) => n.kind === "trigger")) {
      out.push({ ruleId: "FLOW001", severity: "warning", title: "Flow has no trigger", detail: `Flow "${fl.name}" has no trigger and can only be started as a child flow.`, componentKey: fl.id });
    }
    if (fl.stateCode === 0) {
      out.push({ ruleId: "FLOW002", severity: "info", title: "Flow is turned off", detail: `Flow "${fl.name}" is in the Draft/Off state; it will be imported off and must be turned on in the target.`, remediation: "Turn flows on after import (or via your pipeline) once connection references are set.", componentKey: fl.id });
    }
  }
  return out;
}

const cmp = (a: ParsedSolution, b: ParsedSolution) => {
  const x = parseVersion(a.version), y = parseVersion(b.version);
  return x && y ? compareVersions(x, y) : 0;
};
