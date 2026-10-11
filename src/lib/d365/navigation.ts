import { arr, findAll, guid, text } from "./xml";
import type { ParsedApp, ParsedSiteMap, SiteMapSubArea } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const WR = /^\$webresource:/i;
export const webResourceName = (v: string) => v.replace(WR, "").replace(/^\/?WebResources\//i, "");

function titleOf(node: any, fallback: string): string {
  const t = arr(node?.Titles?.Title).find((x) => String(x["@_LCID"]) === "1033") ?? arr(node?.Titles?.Title)[0];
  return String(t?.["@_Title"] ?? node?.["@_ResourceId"] ?? fallback);
}

/** Site map (navigation) trees from customizations.xml: Area > Group > SubArea. */
export function parseSiteMaps(root: any): ParsedSiteMap[] {
  const maps: ParsedSiteMap[] = [];
  const holders = findAll(root, "SiteMap").filter((n) => n && typeof n === "object" && n.Area !== undefined);
  holders.forEach((sm, i) => {
    const areas = arr(sm.Area).map((a) => ({
      id: String(a["@_Id"] ?? ""),
      title: titleOf(a, String(a["@_Id"] ?? "Area")),
      icon: a["@_Icon"] ? String(a["@_Icon"]) : undefined,
      groups: arr(a.Group).map((g) => ({
        id: String(g["@_Id"] ?? ""),
        title: titleOf(g, String(g["@_Id"] ?? "Group")),
        subAreas: arr(g.SubArea).map((s): SiteMapSubArea => ({
          id: String(s["@_Id"] ?? ""),
          title: titleOf(s, String(s["@_Entity"] ?? s["@_Id"] ?? "SubArea")),
          entity: s["@_Entity"] ? String(s["@_Entity"]).toLowerCase() : undefined,
          url: s["@_Url"] ? String(s["@_Url"]) : undefined,
          icon: s["@_Icon"] ? String(s["@_Icon"]) : undefined,
          dashboard: s["@_DefaultDashboard"] ? guid(s["@_DefaultDashboard"]) : undefined,
          privileges: arr(s.Privilege).map((p) => ({ entity: String(p["@_Entity"] ?? "").toLowerCase(), privilege: String(p["@_Privilege"] ?? "") })).filter((p) => p.entity),
        })),
      })),
    }));
    maps.push({ id: String(sm["@_Id"] ?? ""), name: String(text(sm.SiteMapName) || `Site map ${i + 1}`), areas });
  });
  return maps;
}

/** Model-driven apps (AppModule) and the components they declare. */
export function parseApps(root: any): ParsedApp[] {
  return arr(root.AppModules?.AppModule).map((a: any) => ({
    uniqueName: text(a.UniqueName),
    name: String(arr(a.LocalizedNames?.LocalizedName)[0]?.["@_description"] ?? text(a.UniqueName)),
    components: arr(a.AppModuleComponents?.AppModuleComponent).map((c: any) => ({
      type: Number(c["@_type"]),
      key: String(c["@_schemaName"] ?? guid(c["@_id"])).toLowerCase(),
    })),
    roles: arr(a.AppModuleRoleMaps?.Role ?? a.AppModuleRoleMaps?.AppModuleRoleMap).map((r: any) => guid(r["@_id"])).filter(Boolean),
  })).filter((a) => a.uniqueName);
}
