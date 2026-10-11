# Changelog

All notable changes to this project are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/), versioning: [SemVer](https://semver.org/). The app version lives in `package.json` and is stamped on every in-app audit-log entry.

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
