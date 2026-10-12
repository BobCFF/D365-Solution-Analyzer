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
| Encryption (AES-256-GCM, per-user keys) | `src/lib/server/crypto.ts` |
| Auth, `withUser`, limits, error shape, logging, env checks | `src/lib/server/{auth,api,api-response,log,env}.ts`, `src/instrumentation.ts` |
| Dynamics 365 connections: validation, Dataverse read-only client, target check | `src/lib/d365/{environment,targetCheck}.ts`, `src/lib/server/dataverse.ts`, `src/lib/connections.ts`, `src/app/api/connections/**`, `src/app/api/solutions/[id]/verify` |
| Browser API client | `src/lib/api-client.ts` |
| Public pages | `src/app/{privacy,terms}/page.tsx` |
| DB access (sealed) + audit log | `src/lib/store.ts`, `supabase.ts`, `supabase/migrations/` |
| CSP / headers | `src/middleware.ts`, `next.config.mjs` |
| API | `src/app/api/{solutions,solutions/[id],compare,changelog}` |
| UI | `src/components/{Dashboard,views,ui,CompareApp,FlowDiagram,insights}.tsx`, tokens in `src/app/globals.css` |

## Data model notes
`solutions.parsed` and `solutions.meta` hold sealed (encrypted) JSON: the full `ParsedSolution` and the display metadata. Postgres cannot query inside them by design; the app decrypts per request. Findings are recomputed (delete + insert) on every analysis because results depend on what else is loaded (parent solutions, dependencies).

## Borrowed from D365 ERD Builder
Relationship categories (`relationshipCategory`), privilege parsing (`prvVerbEntity`, depth words/masks), field-permission masks, prefix-based grouping, and the UI conventions above.

## Borrowed from Salesforce Analyzer
Compare page layout (type sidebar, status tabs, tree grid, bottom pane), status vocabulary and dot, "Tick dependencies" deploy-readiness flow (`requirements()` BFS + needed/ok/missing buckets), Uses / Used-by dependency tab, and the flow diagram with new/changed/deleted overlay.
