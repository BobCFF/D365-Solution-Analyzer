/** Dataverse solution component type codes (componenttype option set). */
export const COMPONENT_TYPES: Record<number, string> = {
  1: "Table (Entity)",
  2: "Column (Attribute)",
  9: "Choice (Option Set)",
  10: "Relationship",
  20: "Security Role",
  21: "Security Role Privilege",
  24: "Field Security Profile",
  26: "View (Saved Query)",
  29: "Cloud Flow / Process",
  31: "Report",
  36: "Email Template",
  59: "Chart (Saved Query Visualization)",
  60: "Form (System Form)",
  61: "Web Resource",
  62: "Site Map",
  63: "Connection Role",
  65: "Hierarchy Rule",
  66: "Custom Control",
  68: "Custom Control Default Config",
  80: "Model-driven App",
  90: "Plug-in Type",
  91: "Plug-in Assembly",
  92: "SDK Message Processing Step",
  93: "SDK Message Processing Step Image",
  95: "Service Endpoint",
  150: "Routing Rule",
  300: "Canvas App",
  371: "Connector",
  372: "Connector",
  380: "Environment Variable Definition",
  381: "Environment Variable Value",
  400: "AI Project Type",
  401: "AI Project",
  402: "AI Configuration",
  430: "Entity Analytics Configuration",
  9001: "Connection Reference",
  431: "Attribute Image Configuration",
  432: "Entity Image Configuration",
};

export function componentTypeName(type: number): string {
  return COMPONENT_TYPES[type] ?? `Component type ${type}`;
}

/** Component types whose key in solution.xml is a schemaName rather than a GUID id. */
export const NAMED_TYPES = new Set([1, 2, 9, 61, 91, 380]);
