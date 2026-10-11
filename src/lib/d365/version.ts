export interface SolutionVersion {
  major: number;
  minor: number;
  build: number;
  revision: number;
}

/** Dataverse solution versions are major.minor.build.revision (also accepts major.minor). */
export function parseVersion(v: string): SolutionVersion | null {
  const m = /^(\d+)\.(\d+)(?:\.(\d+)\.(\d+))?$/.exec(v.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    build: Number(m[3] ?? 0),
    revision: Number(m[4] ?? 0),
  };
}

export function compareVersions(a: SolutionVersion, b: SolutionVersion): number {
  for (const k of ["major", "minor", "build", "revision"] as const) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  return 0;
}
