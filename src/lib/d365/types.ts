export type Severity = "error" | "warning" | "info";

export interface Publisher {
  uniqueName: string;
  customizationPrefix: string;
  customizationOptionValuePrefix: number | null;
}

export interface RootComponent {
  type: number;
  /** schemaName for named components, id (GUID) otherwise */
  key: string;
  /** 0 = include subcomponents, 1 = do not include subcomponents, 2 = include as shell */
  behavior: number;
}

export interface MissingDependency {
  requiredType: string;
  requiredName: string;
  requiredSolution: string;
  dependentType: string;
  dependentName: string;
}

/** Item discovered in customizations.xml (entity, workflow, web resource, ...). */
export interface InventoryItem {
  type: number;
  typeName: string;
  key: string;
  displayName?: string;
  /** free-form facts used by rules and compare (e.g. attribute names, category) */
  details?: Record<string, string | number | boolean | string[]>;
}

export interface ParsedSolution {
  uniqueName: string;
  friendlyName: string;
  version: string;
  managed: boolean;
  /** Set when the package is a patch (ParentSolution/PatchParent present). */
  parentSolutionName: string | null;
  publisher: Publisher | null;
  rootComponents: RootComponent[];
  missingDependencies: MissingDependency[];
  inventory: InventoryItem[];
  /** Files present in the package, for package-structure checks. */
  files: string[];
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  title: string;
  detail: string;
  remediation?: string;
  componentKey?: string;
}
