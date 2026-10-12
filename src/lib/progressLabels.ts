/** Human wording for the busy dialog, derived from the API call being made (pure, tested). */
export function labelFor(path: string, method = "GET"): string {
  const p = path.split("?")[0].replace(/\/+$/, "");
  const m = method.toUpperCase();
  if (/^\/api\/solutions\/[^/]+\/dependencies$/.test(p)) return "Resolving dependencies";
  if (p === "/api/import-plan") return "Planning the import order";
  if (/^\/api\/solutions\/[^/]+$/.test(p)) return m === "DELETE" ? "Deleting solution" : m === "POST" ? "Re-running analysis" : "Loading solution";
  if (p === "/api/solutions") return m === "POST" ? "Analyzing and saving solution" : "Loading your solutions";
  if (p === "/api/changelog") return "Loading the change log";
  if (p === "/api/compare") return "Recording the comparison";
  if (p === "/api/account/export") return "Preparing your data export";
  if (p === "/api/account") return "Deleting all your data";
  if (p === "/api/health") return "Checking system status";
  return "Working";
}
