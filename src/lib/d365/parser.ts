import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { componentTypeName } from "./componentTypes";
import type {
  InventoryItem,
  MissingDependency,
  ParsedSolution,
  Publisher,
  RootComponent,
} from "./types";

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

export class SolutionParseError extends Error {}

/* eslint-disable @typescript-eslint/no-explicit-any */
const arr = (v: any): any[] => (v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : [v]);
const text = (v: any): string => {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return String(v["#text"] ?? "");
  return String(v);
};

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
  parsed.inventory = customizationsXml ? parseCustomizationsXml(customizationsXml) : [];
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
export function parseCustomizationsXml(content: string): InventoryItem[] {
  const root = xml.parse(content)?.ImportExportXml;
  if (!root) return [];
  const items: InventoryItem[] = [];
  const add = (type: number, key: string, displayName?: string, details?: InventoryItem["details"]) => {
    if (key) items.push({ type, typeName: componentTypeName(type), key, displayName, details });
  };

  for (const e of arr(root.Entities?.Entity)) {
    const name = text(e.Name);
    const attrs = arr(e.EntityInfo?.entity?.attributes?.attribute).map((a) => String(a["@_PhysicalName"] ?? "")).filter(Boolean);
    add(1, name.toLowerCase(), e.Name?.["@_LocalizedName"], {
      attributes: attrs,
      attributeCount: attrs.length,
      forms: arr(e.FormXml?.forms).reduce((n: number, f: any) => n + arr(f.systemform).length, 0),
      views: arr(e.SavedQueries?.savedqueries?.savedquery).length,
    });
  }
  for (const w of arr(root.Workflows?.Workflow)) {
    add(29, String(w["@_WorkflowId"] ?? w["@_Name"] ?? "").toLowerCase(), w["@_Name"], {
      category: Number(text(w.Category) || -1),
      stateCode: Number(text(w.StateCode) || -1),
      primaryEntity: text(w.PrimaryEntity),
    });
  }
  for (const r of arr(root.WebResources?.WebResource)) {
    add(61, text(r.Name), text(r.DisplayName), { webResourceType: Number(text(r.WebResourceType) || -1) });
  }
  for (const o of arr(root.optionsets?.optionset)) add(9, String(o["@_Name"] ?? ""), String(o["@_localizedName"] ?? ""));
  for (const r of arr(root.Roles?.Role)) add(20, String(r["@_id"] ?? "").toLowerCase(), String(r["@_name"] ?? ""));
  for (const p of arr(root.FieldSecurityProfiles?.FieldSecurityProfile)) add(24, String(p["@_fieldsecurityprofileid"] ?? p["@_name"] ?? "").toLowerCase(), String(p["@_name"] ?? ""));
  for (const a of arr(root.AppModules?.AppModule)) add(80, text(a.UniqueName), text(a.LocalizedNames?.LocalizedName?.["@_description"]));
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
  return items;
}
