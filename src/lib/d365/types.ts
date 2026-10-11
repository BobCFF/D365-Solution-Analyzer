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

export interface EntityAttribute {
  name: string;
  type: string;
  required: string;
  display: string;
  custom?: boolean;
  secured?: boolean;
  audit?: boolean;
  optionSet?: string;
  maxLength?: string;
  format?: string;
  pk?: boolean;
  /** lookup target tables, from OneToMany relationships */
  targets?: string[];
}

export interface ParsedEntity {
  logical: string;
  display: string;
  /** publisher prefix (text before first "_") or "" for standard/system tables */
  prefix: string;
  attributes: EntityAttribute[];
}

export type RelationshipCategory = "business" | "ownership" | "audit" | "portal" | "generic";

export interface ParsedRelationship {
  name: string;
  type: string;
  referenced: string;
  referencing: string;
  attribute: string;
  category: RelationshipCategory;
}

export type AccessLevel = "none" | "user" | "bu" | "deep" | "org";

export interface ParsedRole {
  id: string;
  name: string;
  /** table logical name -> verb -> highest access level */
  privileges: Record<string, Record<string, AccessLevel>>;
}

export interface FieldPermission {
  entity: string;
  attribute: string;
  create: boolean;
  read: boolean;
  update: boolean;
}

export interface ParsedFieldProfile {
  id: string;
  name: string;
  permissions: FieldPermission[];
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
  /** Added in 0.2.0 - absent on rows stored by 0.1.0, so always read with `?? []`. */
  entities?: ParsedEntity[];
  relationships?: ParsedRelationship[];
  roles?: ParsedRole[];
  fieldProfiles?: ParsedFieldProfile[];
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
