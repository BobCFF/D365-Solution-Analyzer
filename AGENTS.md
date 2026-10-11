# AGENTS.md - working on D365 Solution Analyzer

Goal: correct changes with minimal rework. Orient with `ARCHITECTURE.md`, then `TODO.md`, then `CHANGELOG.md`.

## Golden rules
- **Parse in the browser, analyze deterministically.** `src/lib/d365/*` is pure TypeScript with no I/O; it runs in both the browser (parser) and the server (analyzer re-run). Keep it that way so it is unit-testable.
- **Rules are data-driven findings** with a stable `ruleId` (`PKG`, `VER`, `PUB`, `MAN`, `DEP`, `DUP`, `ENV`, `WF`, `PAT`, `LAY`, `REL`, `SEC`, `FLD`, `ATT`, `NAV`, `FLOW`). Add a unit test for every rule; never reuse or renumber an ID. Each finding states the problem *and* a Microsoft-supported remediation.
- **Back-compat for stored rows:** `solutions.parsed` is JSONB written by older versions. New `ParsedSolution` fields are optional and read with `?? []`.
- **Trust nothing from the client:** the API validates the payload (`validate.ts`), uses the caller's JWT so RLS applies, and never uses a service-role key.
- **Escape/neutralise output:** React escapes text; CSV exports go through `toCsv` (formula-injection safe). No `dangerouslySetInnerHTML` with data.
- **House style (shared with ERD Builder):** CSS custom properties only (`--surface`, `--ink`, `--accent`...), five `[data-theme]` palettes (System/Light/Dark/High contrast/Monochrome), zebra tables, tabs top bar, confirm dialog before destructive actions, theme name shown beside the cycle button. Verify new UI in every theme and at ~390px width.
- Keep the audit trail: any new mutating API action calls `logChange`.

- **Dependency rules favour precision.** A target is "missing" only when it is clearly custom (prefix / web resource / flow / app / env var / connection reference) and provided by nothing loaded; anything ambiguous is `unverifiable`. Add a test for each new reference kind in `tests/d365.test.ts`.
- **Never store flow expressions or parameter values** (they can hold secrets). `flow.ts` keeps names, types, connectors, operation ids and safe literals only.
- **Compare vocabulary** is source -> target: New (only in source), Deleted (only in target), Different, Identical (same as Salesforce Analyzer). Status dot uses shape + colour (`.di`).

- **Storage is sealed.** Never write customer-derived text to Postgres, logs or error messages in plaintext. Go through `src/lib/store.ts` (`sealJson`/`unsealJson`, purpose strings are part of the AAD) and add any new column to the migration's `CHECK (... like 'enc:v1:%')` pattern. Keep only ids, timestamps and rule ids/severities in the clear. `tests/store.test.ts` asserts no plaintext reaches the DB; extend it for new tables. Never import `src/lib/server/*` from client code; never use a service-role key.
- **API routes** are `export const GET = withUser(async (req, ctx, params) => { ... })` (`src/lib/server/api.ts`): it authenticates (`getClaims`, allow-list, encryption check), turns thrown `HttpError`s into `{ error, code }` and everything else into a logged generic 500. Validate ids with `isUuid`, bodies with zod (see `validate.ts`), apply `auditLimit()` (mutations) or `memoryLimit()` (heavy reads), and call `logChange` when you mutate. Never return raw upstream/DB messages; log with `log.*` (no solution content).
- **Configuration** is read with `getEnv("NAME")` (`src/lib/server/config.ts`): `D365_SolAna_NAME` first, then `NAME`. Browser-visible values are mapped in `next.config.mjs` (`env`). Add any new setting to `.env.example` and `envProblems()`.
- **Browser calls** go through `makeApi(token)` (`src/lib/api-client.ts`); show `errMsg(e)`. Confirmations use the native-dialog `Confirm`, never `confirm()`.
- **Accessibility bar (jsx-a11y + WCAG 2.2 AA):** `npm run lint` must be clean; toggle groups use `aria-pressed`, navigation uses `aria-current`, errors `role="alert"`, controls use `--field-line` borders (3:1), text on status fills uses `--on-status`, minimum 11px.
- **Triage new review findings** in `docs/REVIEW-ADOPTION.md` (done / not applicable / open) so none are silently dropped.

## Release checklist
1. Code + tests (`npm run check` = typecheck + lint + tests, then `npm run build`).
2. Bump `package.json` version (single source; stamped on log entries and shown in the UI).
3. `CHANGELOG.md` entry (Keep a Changelog, SemVer) and tick items in `TODO.md`.
4. Branch -> PR -> squash-merge to `main`; confirm Vercel "Ready".
