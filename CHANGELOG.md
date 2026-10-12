# Changelog

All notable changes to this project are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/), versioning: [SemVer](https://semver.org/). The app version lives in `package.json` and is stamped on every in-app audit-log entry.

## [0.13.0] - 2026-10-13
### Added
- **Certificate sign-in for Dynamics 365 connections (recommended).** Choose *Certificate* when adding a connection and the app generates the RSA-2048 key pair and a self-signed certificate itself. The **private key is encrypted straight into the database and never shown, downloaded or sent anywhere**; you only download the public `.cer` and upload it to the app registration (Entra > Certificates & secrets > Certificates). Sign-in uses a signed client assertion (RFC 7523, RS256, `x5t`/`x5t#S256` headers, 10-minute lifetime), so **no client secret exists to leak**.
- The Environments table shows each connection's sign-in method and certificate expiry (highlighted within 30 days), and a **Certificate** action re-downloads the public certificate. Entra error codes for certificate problems now give plain-language fixes.
- Client-secret connections still work unchanged (existing saved connections need no action).

**Migration:** none (the certificate is stored inside the existing sealed connection value).

## [0.12.0] - 2026-10-13
### Added
- **Connect a Dynamics 365 environment** (new **Environments** tab) and **verify missing dependencies against it**. On Analysis > Missing dependencies, pick a saved environment and press *Verify against environment*: every component still missing after looking at all loaded solutions (including GUID-addressed views, forms, roles and dashboards that were previously only "to verify") is looked up in the real environment, and a new **In target environment** column shows *Present*, *Missing in target* or *Not checked*. Present rows drop to info severity, confirmed-missing rows say so, and required solutions are compared against the installed solutions and versions (e.g. "installed 1.2.0.0 is older than the required 2.0.0.0").
- Checks cover tables, columns, web resources, cloud flows, model-driven apps, environment variables, connection references, security roles, views, forms, charts, site maps and plug-in assemblies, plus installed solutions. Anything the application user may not read shows as *Not checked* with a note.
- Microsoft-supported and read-only: Microsoft Entra client credentials with an application user in the environment, Dataverse Web API v9.2, GET requests only. A guide for creating the app registration and application user is on the Environments tab.
- Security: the whole connection (including the client secret) is one AES-256-GCM sealed value, per-user key; the secret is never sent to the browser; only Microsoft-hosted Dataverse URLs are accepted (SSRF guard), redirects are not followed, tokens are never stored; results are shown in the browser and not saved. Connections are included in *Delete all my data* and (without secrets) in the data export.

**Migration:** run `supabase/migrations/20261013000000_d365_connections.sql` in the Supabase SQL editor (safe to re-run; adds the `d365_connections` table and the `connect`/`verify` audit actions; no data is dropped). Until then the app works as before and the Environments tab explains what is missing.

## [0.11.1] - 2026-10-12
### Changed
- The progress dialog now says "Analyzing and saving solution" (and the upload stage "analyzing for errors, then encrypting and saving") because the error analysis runs while a solution is saved.

## [0.11.0] - 2026-10-12
### Added
- **Progress dialog whenever the app is working.** Every request to the server (loading solutions, opening one, dependency resolution, import plan, re-run analysis, delete, data export, comparison log) shows a modal "please wait" dialog with a plain-language label. Uploading solutions shows named stages with a percentage per file (reading, unpacking/parsing in the browser, encrypting and saving) and Compare shows its loading/comparing steps. The dialog appears after 0.2 s (no flicker on quick calls), stays at least 0.5 s once shown, cannot be dismissed with Esc, and respects reduced-motion.

## [0.10.0] - 2026-10-12
### Added
- **Adjustable column widths** on every table (including the Compare grid): drag the edge of a header, or focus it and use the left/right arrow keys. Double-click an edge, or press Reset in the Columns list, to restore automatic widths. Widths are remembered per account in this browser with the rest of the saved view (clamped to 48-1,200 px; unknown columns ignored).

## [0.9.1] - 2026-10-12
### Changed
- Pages now use the full browser width and height (no centred 1,200px column); tables, the Compare grid and the flow diagram grow with the window instead of fixed heights. Legal pages keep a readable line width.

## [0.9.0] - 2026-10-12
### Added
- **Column menus on every table.** The ⋯ header menu (sort, multi-select / contains filter, move left/right, hide), the Columns list, quick search and CSV export now apply to the **Solutions list, Data Dictionary, Dependencies, Security (privileges and field permissions), Change log, the Compare grid** (tree, ticking and the detail pane keep working; filters expand matching parents) and the Compare **Uses / Used by** tables, in addition to the Analysis table. The Dependencies table starts filtered to what needs attention. Tables show up to 2,000 rows (with a note and CSV export for the rest). Extra Data Dictionary columns (primary key, custom, secured, option set, max length) and a Patch parent column are available from the Columns list.
- **The app remembers where you left off**, per account, in this browser: the last page, the selected solution (reopened on return), the Analysis view and its filters/solution selection, each table's filters, search, sort order and column layout, the Compare pair, tab and type (the comparison re-runs on return), Security role/profile and the selected flow. Corrupt or outdated saved state falls back to defaults, and column layouts repair themselves when columns change between versions.
- **Reset saved view settings** (Change log tab) and Delete all my data also clear the remembered view. Nothing about the saved view is sent to the server.

### Changed
- Column menus stay fully on screen on phones (shifted up near the bottom edge).

## [0.8.0] - 2026-10-12
### Changed
- **Column menus replace the filter row.** Every column header on the Missing dependencies table has a **⋯ menu**: sort A→Z / Z→A, filter, **move left / right** and **hide column**. Set-like columns (Severity, type, solution, availability, ...) filter with a **multi-select value list** (counts, search for long lists, Select all / none); text columns filter with "contains". A filtered column's ⋯ is highlighted, and Clear filter / Clear column filters reset them. Menus are keyboard-operable (Esc closes and returns focus), stay inside the viewport on phones, and do not close while you scroll their value list.
- **Columns list** (toolbar): tick which columns to include, Show all, Reset. The column **order and visibility are remembered** per table in the browser and repair themselves when columns are added or removed in later versions.

## [0.7.0] - 2026-10-12
### Added
- **Analysis page leads with a parsed Missing dependencies table**: one row per missing dependency, merging the platform's own `MissingDependencies` from `solution.xml` with this tool's reference scan (navigation, forms, apps, flows, roles, schema), de-duplicated. Columns: severity, required type, required component (name + key), required solution (name + version, Microsoft/system tag), availability (is the required solution loaded in your workspace?), required by (type, name, where), how to fix; plus optional Status, Parent of required, Required-by type, Relationship and Source. "All findings" is one click away.
- **Reusable column-filter table** (`ColumnTable`): a filter under every column header (dropdown with counts for set-like columns, text box otherwise), sortable headers (numeric-aware), a **Columns** menu to show/hide columns (remembered in the browser), Clear column filters, and CSV export of the visible rows and columns. The Solutions dropdown / Hide Microsoft-system toggle applies to the table too.
- The parser now keeps the structured fields of `MissingDependency` (key, parent, solution name and version split out of `"Name (1.0.0.0)"`). Packages loaded before 0.7.0 show the same table with fewer fields until re-uploaded.
- `/api/solutions/[id]/dependencies` also returns the names of the other loaded solutions.

### Fixed
- Solution names in findings and the import-order planner no longer include the version suffix from `solution.xml` (`"Name (1.0.0.0)"`), which broke solution filtering and ordering.
- Dropdown menus (Solutions, Columns) close on Esc, on an outside click, and when another menu opens.

## [0.6.0] - 2026-10-12
### Added
- **Analysis filters.** Findings can be filtered by severity, **category** (Dependencies, Navigation, Flows, Patches, Publisher, ...), free text, and by the **other solutions they refer to**: a "Solutions" dropdown lists every solution referenced by the findings (with counts) so you can pick which to include, and **Hide Microsoft / system solutions** removes findings that only involve platform solutions (Default, System, Active, Basic, `msdyn_*`, `mscrm*`, `Microsoft*`, ...). Findings that refer to no other solution are always shown. CSV export respects the filters; the system-solution toggle is remembered in the browser.
- Findings now record the solutions they refer to (required solution on missing dependencies, overlapping solution, patch parent), shown on each finding. Findings stored by earlier versions gain this after **Re-run**.

## [0.5.1] - 2026-10-11
### Added
- **Prefixed configuration.** All settings can be provided as `D365_SolAna_SUPABASE_URL`, `D365_SolAna_SUPABASE_ANON_KEY`, `D365_SolAna_DATA_ENCRYPTION_KEY`, `D365_SolAna_DATA_ENCRYPTION_KEYS_PREVIOUS` and `D365_SolAna_ALLOWED_EMAILS` (the previous names still work as fallbacks; the prefixed name wins). The Supabase URL and anon key are inlined into the browser bundle at build time from `next.config.mjs`, so they no longer need a `NEXT_PUBLIC_` name. Useful when several apps share one Vercel team or Supabase integration variables already exist. Verified by building and loading the app with only prefixed variables.

## [0.5.0] - 2026-10-11
Applies the findings of the D365 ERD Builder and Salesforce Analyzer reviews that fit this project; every finding ID is triaged in `docs/REVIEW-ADOPTION.md`.

### Security
- Zod-validated, size-bounded upload payload (deep schema, unknown keys dropped), so the server-side analyzer can never be crashed or fed junk by a crafted request.
- Abuse limits: durable hourly limits on upload/analyze/compare, per-instance limits on heavy reads, a 200-solution quota.
- `apiGuard` middleware: cross-site `Origin` and non-JSON bodies refused on API writes.
- JWT verified locally with `getClaims()` (no auth round trip per request).
- One safe `{ error, code }` response shape; structured, scrubbed JSON logging; failures never leak internals.
- A solution that cannot be decrypted (rotated or wrong key) no longer breaks the app: it is counted, hidden and explained.
- Dependabot, `engines`/`.nvmrc`.

### Added
- **Status panel** (Change log tab, `GET /api/health`): configuration problems, whether the migration is applied, encryption self-test, access mode. Startup logs the same problems.
- **Download my data** (`GET /api/account/export`) next to Delete all my data.
- `/privacy` and `/terms` pages (drafts for the operator to finalize), MIT `LICENSE`, Open Graph metadata (`noindex`).
- ESLint (Next, react-hooks, jsx-a11y) in `npm run lint` / `npm run check` and CI; 15 new tests (guard, validation, limiter, logging, env, storage).

### Changed (accessibility, UX)
- Native `<dialog>` for confirmations (focus trap, Esc, focus return); `<nav>` with `aria-current`; `aria-pressed` on toggle groups.
- Login is a proper labelled form with autocomplete, forgot-password and set-new-password flow.
- Contrast: 3:1 control borders and `--on-status` text on status fills in all five themes; 11px minimum text; reduced-motion support; visible focus outline.
- Signed-in email shown beside Sign out.

## [0.4.0] - 2026-10-12
### Security
- **Encrypted storage.** All content-bearing data (solution metadata, parsed model, findings, comparison results, audit log) is sealed with AES-256-GCM in the application before it reaches Supabase, using per-user keys derived with HKDF and bound to the user and column via AAD. The database only ever holds ciphertext; `CHECK` constraints reject plaintext. Duplicate detection uses per-user HMACs instead of names or file hashes. The app fails closed if `DATA_ENCRYPTION_KEY` is not set. Key rotation supported via `DATA_ENCRYPTION_KEYS_PREVIOUS`.
- Authentication hardening: JWT validated against Supabase Auth on each request, optional `ALLOWED_EMAILS` allow-list, generic error responses, `no-store` caching on APIs.
- Database: tables recreated with `FORCE ROW LEVEL SECURITY`, `anon`/`public` grants revoked, immutable rows (no UPDATE policy), plaintext `solution_components` table removed.
- Nonce-based Content-Security-Policy (middleware), HSTS, CORP, tightened headers.
- **Delete all my data** (Change log tab, `DELETE /api/account`) for right to erasure.
- Dependencies upgraded (Next.js 16, fast-xml-parser 5) to clear all `npm audit` findings.
- New `docs/SECURITY.md`; `.env.example` documents the key; `PRIVACY.md` updated; CI runs `npm audit`.

### Changed (breaking for stored data)
- Migration `20261012000000_encrypted_storage.sql` replaces the plaintext tables. Rows from v0.1-v0.3 are dropped; re-upload packages after applying (nothing had been deployed).
- API list/detail shapes are unchanged; `POST /api/solutions` returns the finding count instead of the findings array.

## [0.3.0] - 2026-10-11
### Added
- **Missing-dependency engine** (`dependencies.ts`): builds a reference graph from site maps, model-driven apps, forms, web resources, flows, roles and schema, and resolves every edge against the solution, all other loaded solutions and the platform. Only clearly-custom absent components are flagged; GUID-addressed views/forms/roles are reported as "verify in target" to avoid false alarms. Rules `DEP101-DEP108`.
- **Navigation analysis**: site map Area/Group/SubArea trees and app modules are parsed. Rules `NAV001` missing table, `NAV002` missing web resource, `NAV003` duplicate Id, `NAV004` no role can read the table, `NAV005` app without site map, `NAV006` empty area, `NAV007` sub area without target. New Navigation tab marks each item OK / missing / verify.
- **Power Automate flow visualizer**: cloud flows (`Workflows/*.json`) become a safe summary model (no expressions or parameter values stored) and render as a pan/zoom SVG diagram with nested If/Switch/Foreach/Scope containers, run-after failure paths, connector/operation labels and a details pane. Flow dependencies (connection references, environment variables, child flows) feed the dependency engine. Rules `FLOW001`, `FLOW002`.
- **Dependencies tab**: resolved dependency table with status filters and CSV export, plus a suggested **import order** for all loaded solutions (`/api/import-plan`).
- **Compare redesign** modelled on Salesforce Analyzer: source/target pickers, compared-types sidebar with counts, status tabs (All / New / Different / Deleted / Identical), selectable tree grid (tables > columns, site maps > items), keyboard navigation, bottom pane with Summary, Dependencies (Uses / Used by) and a **flow diagram diff** (new / changed / deleted steps). Ticking rows shows deploy readiness: "Tick dependencies" adds required New/Different items, components missing from both sides block with a warning, and a deployment checklist can be exported.

### Changed
- Compare now runs in the browser from the two parsed solutions (the server still records it in the change log).
- Internal pseudo component type `9001` = connection reference.

## [0.2.0] - 2026-10-11
### Added
- Packages are now unpacked **in the browser**; only parsed metadata is sent to the server (no 4 MB zip limit, raw file never uploaded). Server validates the payload (`validate.ts`).
- Parser reads tables with column metadata (type, required, custom, secured, option set), `EntityRelationships` with ERD-Builder-style categories, security roles (privilege depth) and field security profiles.
- Rules: `REL001` relationship to a table not in the solution, `SEC001` role privileges on missing tables, `FLD001/FLD002/FLD003` field-security gaps, `ATT001` columns from another publisher.
- Compare: column-level added/removed/type/required changes (type changes flagged breaking) and security role differences.
- New UI modelled on D365 ERD Builder: tab bar (Solutions, Analysis, Data Dictionary, Security, Compare, Change log), drop zone, five themes (System/Light/Dark/High contrast/Monochrome), zebra tables, sortable/searchable Data Dictionary with CSV export, role/field-security grids, delete confirmation, toasts.
- CSV export with formula-injection protection; security headers via `next.config.mjs`.
- CI (typecheck, tests, build, CHANGELOG/version lockstep); `AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `PRIVACY.md`, `TODO.md`.

### Fixed
- Column parsing now follows real `customizations.xml` structure (`<LogicalName>`/`<Name>` child elements); 0.1.0 assumed a `PhysicalName` attribute only.

### Changed
- `POST /api/solutions` takes JSON (`fileName`, `fileSha256`, `parsed`) instead of multipart zip.

## [0.1.0] - 2026-10-11
### Added
- Next.js (App Router) + Supabase scaffold, deployable on Vercel.
- Solution package parser (`solution.xml`, `customizations.xml`, package structure) for managed/unmanaged solutions and patches.
- Analyzer rules: package structure, version format, publisher/prefix, missing dependencies, duplicate root components, environment variables, classic workflows, patch versioning/parent checks, cross-solution layering overlaps.
- Solution comparison (metadata, added/removed/changed components, column diffs).
- Supabase schema with owner-scoped RLS, including an audit `change_log` table.
- Upload / analyze / compare / change-log UI and REST API.
