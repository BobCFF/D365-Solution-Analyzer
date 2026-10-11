# Changelog

All notable changes to this project are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/), versioning: [SemVer](https://semver.org/). The app version lives in `package.json` and is stamped on every in-app audit-log entry.

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
