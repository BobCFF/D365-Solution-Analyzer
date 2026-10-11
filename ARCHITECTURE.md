# Architecture

Next.js (App Router) on Vercel + Supabase (Postgres, Auth, RLS).

```
Browser                                   Server (Vercel)                 Supabase
 .zip -> parseSolutionZip (JSZip+XML) --> POST /api/solutions (JSON)  --> solutions, solution_components,
 sha256 via WebCrypto                        validateParsed                analysis_findings, comparisons,
 tabs: Solutions/Analysis/Dictionary/        analyzeSolution (+others)     change_log   (all RLS: owner only)
       Security/Compare/Change log           compareSolutions
```
Requests carry the user's Supabase JWT (`Authorization: Bearer`); `clientForRequest` forwards it so RLS enforces ownership.

## Map
| Area | Where |
|------|-------|
| Package + XML parsing (`solution.xml`, `customizations.xml`) | `src/lib/d365/parser.ts` |
| Types / component-type codes / version math | `types.ts`, `componentTypes.ts`, `version.ts` |
| Rules (package, publisher, deps, patches, layering, tables, security) | `analyzer.ts` |
| Dependency graph, resolver, transitive requirements, import-order planner | `dependencies.ts` |
| Site map / app parsing | `navigation.ts` |
| Cloud flow model, layout, diff | `flow.ts`, `flowLayout.ts` |
| Compare: facets, status, deploy readiness; tree/filters | `comparison.ts`, `compareTree.ts` |
| Legacy summary diff (server log) | `compare.ts` |
| Payload validation | `validate.ts` |
| DB access + audit log | `src/lib/store.ts`, `supabase.ts`, `supabase/migrations/` |
| API | `src/app/api/{solutions,solutions/[id],compare,changelog}` |
| UI | `src/components/{Dashboard,views,ui,CompareApp,FlowDiagram,insights}.tsx`, tokens in `src/app/globals.css` |

## Data model notes
`solutions.parsed` holds the full `ParsedSolution` (entities, relationships, roles, field profiles, inventory). `solution_components` is a queryable flattening. Findings are recomputed (delete + insert) on every analysis because results depend on what else is loaded (parent solutions, dependencies).

## Borrowed from D365 ERD Builder
Relationship categories (`relationshipCategory`), privilege parsing (`prvVerbEntity`, depth words/masks), field-permission masks, prefix-based grouping, and the UI conventions above.

## Borrowed from Salesforce Analyzer
Compare page layout (type sidebar, status tabs, tree grid, bottom pane), status vocabulary and dot, "Tick dependencies" deploy-readiness flow (`requirements()` BFS + needed/ok/missing buckets), Uses / Used-by dependency tab, and the flow diagram with new/changed/deleted overlay.
