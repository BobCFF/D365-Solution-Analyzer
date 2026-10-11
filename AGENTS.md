# AGENTS.md - working on D365 Solution Analyzer

Goal: correct changes with minimal rework. Orient with `ARCHITECTURE.md`, then `TODO.md`, then `CHANGELOG.md`.

## Golden rules
- **Parse in the browser, analyze deterministically.** `src/lib/d365/*` is pure TypeScript with no I/O; it runs in both the browser (parser) and the server (analyzer re-run). Keep it that way so it is unit-testable.
- **Rules are data-driven findings** with a stable `ruleId` (`PKG`, `VER`, `PUB`, `MAN`, `DEP`, `DUP`, `ENV`, `WF`, `PAT`, `LAY`, `REL`, `SEC`, `FLD`, `ATT`). Add a unit test for every rule; never reuse or renumber an ID. Each finding states the problem *and* a Microsoft-supported remediation.
- **Back-compat for stored rows:** `solutions.parsed` is JSONB written by older versions. New `ParsedSolution` fields are optional and read with `?? []`.
- **Trust nothing from the client:** the API validates the payload (`validate.ts`), uses the caller's JWT so RLS applies, and never uses a service-role key.
- **Escape/neutralise output:** React escapes text; CSV exports go through `toCsv` (formula-injection safe). No `dangerouslySetInnerHTML` with data.
- **House style (shared with ERD Builder):** CSS custom properties only (`--surface`, `--ink`, `--accent`...), five `[data-theme]` palettes (System/Light/Dark/High contrast/Monochrome), zebra tables, tabs top bar, confirm dialog before destructive actions, theme name shown beside the cycle button. Verify new UI in every theme and at ~390px width.
- Keep the audit trail: any new mutating API action calls `logChange`.

## Release checklist
1. Code + tests (`npm test`, `npm run typecheck`, `npm run build`).
2. Bump `package.json` version (single source; stamped on log entries and shown in the UI).
3. `CHANGELOG.md` entry (Keep a Changelog, SemVer) and tick items in `TODO.md`.
4. Branch -> PR -> squash-merge to `main`; confirm Vercel "Ready".
