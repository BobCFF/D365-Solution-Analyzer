# Applying the sibling-project reviews

This project shares most of its design with **D365 ERD Builder** (`REVIEW.md`, reviewed at v2.8.1) and **Salesforce Analyzer** (`docs/REVIEW-2026-10-01.md`, v0.51.0). Every finding ID from both reviews is triaged here so nothing is silently skipped.

Status: ✅ done (version noted) · ➖ not applicable (reason) · 📋 open (tracked in `TODO.md`).

## D365 ERD Builder review

| ID | Finding | Status |
|---|---|---|
| BUG-1 / SEC-1 | DOM XSS through unescaped parsed values | ✅ React escapes all rendered text; no `dangerouslySetInnerHTML` with data (only a constant theme script, nonce'd); strict nonce CSP (0.4.0) |
| BUG-2 | Hover rebuilds the whole diagram | ✅ flow layout is memoized; hover/selection only toggle classes (0.3.0) |
| BUG-3 / UX-5 / P2-3 | Large-file parse freezes the tab | 📋 parse in a Web Worker + progress |
| BUG-4 | `fit()` timing | ➖ flow diagram refits on layout change (0.5.0) |
| MAINT-1 | Build sources not in repo | ➖ no generated artifact |
| MAINT-2 | No tests / CI | ✅ vitest + CI (0.2.0), lint added (0.5.0) |
| MAINT-3 | No linter | ✅ ESLint: Next + react-hooks + jsx-a11y (0.5.0) |
| MAINT-4 | Version in several places | ✅ `package.json` is the single source; CI checks the changelog |
| SEC-2 | Security headers | ✅ CSP (nonce), HSTS, nosniff, frame, referrer, permissions, CORP/COOP (0.4.0) |
| SEC-3 | Stored-data lifecycle | ✅ erase-all, download-all, sign-out, retention statement (0.4.0 / 0.5.0) |
| SEC-4 | No exfiltration path | ✅ CSP `connect-src` limited to self + Supabase; no third-party scripts |
| SEC-5 | Debug globals exposed | ✅ none exist |
| UX-1 | Theme name at rest | ✅ shown beside the cycle button (0.2.0) |
| UX-2 | Undo | ➖ the app is read-only apart from deleting solutions (confirmed by dialog) |
| UX-3 | Canvas accessibility, modal focus trap | ✅ native `<dialog>`, focusable flow nodes with roles, `aria-pressed`/`aria-current`; 📋 keyboard panning/arrow navigation of the flow canvas |
| UX-4 | Search locates on canvas | 📋 flow step search |
| MKT-1 | SEO / social meta | ✅ description + Open Graph; `noindex` because the app is private (0.5.0) |
| MKT-2 | Say the privacy story louder | ✅ landing, privacy page, SECURITY.md |
| MKT-3 | Shareable view state | ➖ would expose schema in URLs; deliberately not done |
| MKT-4 | Analytics | ✅ none by design |
| LEG-1 | LICENSE | ✅ MIT added (0.5.0), same as ERD Builder; owner to confirm |
| LEG-2 | Font licensing | ➖ system fonts only, nothing embedded |
| LEG-3 | Trademark disclaimer | ✅ footer, terms, README |
| LEG-4 | Privacy claim substantiation | ✅ `PRIVACY.md`, `/privacy`, `docs/SECURITY.md` |

## Salesforce Analyzer review

### Security
| ID | Finding | Status |
|---|---|---|
| F1 | SSRF through stored org URLs | ➖ no outbound requests to user-supplied hosts exist |
| F2 | Operator keys usable by any new account | ➖ no shared third-party keys; `ALLOWED_EMAILS` + "disable sign-up" guidance |
| F3 | Production write guard | ➖ the app never writes to Dataverse |
| F4 | Unsigned OAuth state cookie | ➖ no OAuth flow or auth cookies (Bearer tokens only) |
| F5 | Prompt injection into a write-capable AI | ➖ no AI features |
| F6 | SSRF through AI base URLs | ➖ no AI features |
| F7 | Security headers / clickjacking | ✅ (0.4.0) |
| F8 | Rate limits, abuse caps, quotas | ✅ durable hourly limits on upload/analyze/compare (audit-log counts), per-instance limits on heavy reads, 200-solution quota, 4 MB body cap, zod-bounded payload sizes (0.5.0) |
| F9 | SOQL injection | ➖ no query language built from input |
| F10 | Unvalidated route ids | ✅ UUID checked on every `[id]` and body id (0.4.0) |
| F11 | Crypto: key version, AAD, decrypt failure breaks everything | ✅ versioned envelope + keyring + AAD (0.4.0); tolerant listing, `unreadable` banner, clear error code (0.5.0) |
| F12 | CSRF / Origin / content type | ✅ middleware `apiGuard` (0.5.0); tokens are Bearer headers, so cookies are never ambient authority |
| F13 | Redirect origin from `x-forwarded-host` | ➖ no server-built redirects; auth redirect uses `window.location.origin` |
| F14 | Cross-tenant FK references | ✅ every child row carries `owner_id` under RLS; findings/comparisons are only reachable through owner-checked ids |
| F15 | Raw upstream errors returned | ✅ generic `{ error, code }` + server-side logging (0.5.0) |
| F16 | Supply chain: audit, Dependabot | ✅ `npm audit` in CI (0.4.0), Dependabot (0.5.0) |

### Change safety, reliability, performance
| ID | Finding | Status |
|---|---|---|
| S1–S5 | Change safety | ➖ read-only product (S5 clickjacking ✅ via headers) |
| R1–R3 | Stuck snapshots, long extraction, client retries | ➖ no background jobs or upstream API; analysis is synchronous and bounded |
| R4 | Compare decrypts/pulls everything for a list | 📋 sealed rows prevent SQL-side listing by design; list uses a small sealed `meta` blob (0.4.0). Next: cache decrypted summaries per request |
| D1 | Content duplicated per snapshot / retention | ✅ one row per loaded package; quota + delete + erase-all; 📋 optional auto-retention |
| D2 | Indexes, `(select auth.uid())` in policies | ✅ policies use `(select auth.uid())`; `owner_id` unique key; 📋 add index on `owner_id` if tables grow |
| D3–D4 | Memory, atomic writes | ✅ solution rows are single inserts; findings replaced delete+insert (idempotent); 📋 wrap in an RPC for atomicity |
| N1 | No virtualization | 📋 Dictionary caps at 2,000 rendered rows; compare grid and dependency table need windowing for huge solutions |
| N2 | Diff cache bounded by count | ➖ no module-level cache |
| N3 | Two auth round trips per request | ✅ `getClaims()` verifies the JWT locally (0.5.0); no auth call from middleware |
| AI1 / SF1 / PL1–PL8 | AI pipeline, Salesforce API efficiency, minor perf | ➖ not applicable (PL4 lazy-loading and PL5 layout worker 📋 for the flow canvas) |

### Engineering
| ID | Finding | Status |
|---|---|---|
| B1–B3 | Prod flag, SOQL, OAuth callback bugs | ➖ |
| B4 | Thrown responses become 500s; unvalidated bodies | ✅ `withUser` + zod validation (0.5.0) |
| B5 | Appending to another user's session | ✅ ownership enforced by RLS plus UUID checks |
| B6–B9 | Snapshot/query bugs | ➖ |
| E1 | Oversized components | ✅ views split into focused components; largest is `CompareApp` (~330 lines) |
| E2–E3 | Duplicate saved-state pattern, shared code in feature folders | ✅ shared `ui.tsx`, `api-client.ts`; no per-feature state duplication |
| E4 | Hand-rolled `fetch` everywhere | ✅ typed `makeApi()` / `ApiError` (0.5.0) |
| E5 | Duplicate host regexes / migration detection | ✅ single `/api/health` self-check reports missing migration |
| T1 | `any` and no DB types | ✅ no `any` in app code (strict TS, zod at the boundary); 📋 generated DB types are unnecessary (tables hold sealed blobs) |
| T2 / Q1 | Linter | ✅ ESLint with a11y rules (0.5.0) |
| Q2 | CI | ✅ typecheck, lint, tests, build, audit, changelog check |
| Q3 | Test globs, `engines`, `.nvmrc` | ✅ vitest picks up `tests/**`; `engines` + `.nvmrc` (0.5.0) |
| Q4 | Route / RLS / end-to-end tests | ✅ route guard, validation, limiter, store (no plaintext) tests; 📋 PGlite RLS tests and Playwright in CI |
| Q5 | Pin/renovate | ✅ Dependabot grouped minor/patch |
| O1 / O2 | Observability, error shape | ✅ structured scrubbed logs (`log.ts`), `{ error, code }` (0.5.0); 📋 Sentry/OTel hook |
| C1 | Env validation | ✅ `envProblems()` logged at startup and shown on the Status panel (0.5.0) |
| C2 / C3 | Migration tooling, capability records | 📋 Supabase CLI `config.toml`; migration is re-runnable by dropping (pre-release) |
| EP1–EP3 | State payloads, matcher, double selects | ✅ no `user_state`; middleware matcher excludes static assets |
| EA1 | Clickable non-buttons, dialog focus | ✅ native dialogs; rows use a keyboard-operable grid container; flow nodes are `role=button` |
| EA2 / ED1 / ED2 / EN1 | CSS size, docs, naming | ✅ docs kept current; ARCHITECTURE/AGENTS maps; 📋 split `globals.css` into partials |

### UX and accessibility
| ID | Finding | Status |
|---|---|---|
| U1 | Sign out / who is signed in | ✅ email + Sign out in the top bar (0.5.0) |
| U2 | Dialog focus, Esc | ✅ native `<dialog>` with focus return (0.5.0) |
| U3 | Nav semantics | ✅ `<nav aria-label>` with `aria-current="page"` (0.5.0) |
| U4 | Customers see admin/migration info | ✅ the Status panel only shows the signed-in user's own deployment health and no secrets |
| U5 | Onboarding / demo data | 📋 bundled sample solution + "Explore a sample" |
| U6 | Empty states | ✅ every view has one with a next step |
| U7 | Hidden actions | ✅ actions are visible buttons; ticking shows a selection bar |
| U8 | Confirmation patterns | ✅ one `Confirm` dialog, no `confirm()` |
| U9 | Toggle/error semantics | ✅ `aria-pressed` on toggles, `role="alert"` on errors (0.5.0) |
| U10 | Login form | ✅ labelled `<form>`, autocomplete, Enter submits, forgot-password + set-new-password, sign-up confirmation (0.5.0) |
| U11 | Keyboard gaps | ✅ visible `:focus-visible` outline; 📋 flow canvas arrow-key navigation |
| U12 | Contrast | ✅ 3:1 control borders (`--field-line`), `--on-status` text on status fills in every theme, 11px minimum (0.5.0) |
| U13 / U14 | Matrix navigation aids, microcopy | 📋 |

### Product, legal
| ID | Finding | Status |
|---|---|---|
| M1–M8 | Product/marketing | ➖ out of scope for the engineering pass; M6 trademark ✅ disclaimer |
| L1 | Privacy policy, terms, subprocessors, LICENSE | ✅ `/privacy`, `/terms` (drafts to finalize), subprocessors listed, MIT LICENSE |
| L2 | Data sent to AI providers | ➖ no AI features, nothing leaves the app except to Supabase/Vercel |
| L3 | Stored credentials / keys | ✅ no third-party credentials stored; encryption keys are versioned and rotatable |
| L4 | Account deletion, export, retention | ✅ erase-all and download-all (0.4.0 / 0.5.0); 📋 optional auto-retention |
| L5–L6 | Processor roles, DPA, subprocessors | 📋 DPA template before onboarding customers; subprocessors listed |
| L7 | Partner program | ➖ |
| L8 | Liability for generated changes | ✅ no changes are generated; terms state findings are advisory; immutable audit log |
| L9 | Cookies | ✅ none beyond Supabase's local-storage session |
| L10 | WCAG exposure | ✅ items above; 📋 accessibility statement/VPAT |
