# Changelog

All notable changes to this project are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/), versioning: [SemVer](https://semver.org/). The app version lives in `package.json` and is stamped on every in-app audit-log entry.

## [0.1.0] - 2026-10-11
### Added
- Next.js (App Router) + Supabase scaffold, deployable on Vercel.
- Solution package parser (`solution.xml`, `customizations.xml`, package structure) for managed/unmanaged solutions and patches.
- Analyzer rules: package structure, version format, publisher/prefix, missing dependencies, duplicate root components, environment variables, classic workflows, patch versioning/parent checks, cross-solution layering overlaps.
- Solution comparison (metadata, added/removed/changed components, column diffs).
- Supabase schema with owner-scoped RLS, including an audit `change_log` table.
- Upload / analyze / compare / change-log UI and REST API.
