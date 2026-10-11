# TODO

Legend: P0 first, P1 important, P2 nice-to-have.

## P0
- [ ] Provision Supabase project + apply migration; create Vercel project with env vars (needs owner approval).
- [ ] Validate parser/rules against several real exported solutions and patches (confirm patch XML markers).

## P1
- [ ] Sample solution + "Explore a sample" for first-run onboarding (ERD Builder / Salesforce U5).
- [ ] Parse in a Web Worker with progress for very large packages (ERD BUG-3, Salesforce PL5).
- [ ] Virtualize the Compare grid, Dependencies and Dictionary tables (Salesforce N1).
- [ ] Keyboard navigation and step search on the flow canvas (ERD UX-3/UX-4).
- [ ] PGlite RLS tests for the migration + Playwright smoke in CI (Salesforce Q4).
- [ ] Error tracking hook (Sentry/OTel) behind `log.ts` (Salesforce O1).
- [ ] Optional auto-retention for stored solutions; accessibility statement; DPA template before onboarding customers (Salesforce L4-L6, L10).
- [ ] Bulk re-encryption job for key rotation (`needsRotation()` exists); optional envelope keys via KMS.
- [ ] Optional client-side passphrase mode (zero-knowledge: server cannot decrypt) - trade-off: server-side dependency checks need the key.
- [ ] Rules: plug-in step/isolation mode, forms/views referencing missing columns, option set conflicts, managed-property (`IsCustomizable`) checks.
- [ ] Insights tab (counts by publisher prefix, relationship categories, risk summary) like ERD Builder.
- [ ] Payloads >4 MB: chunked upload or Storage-backed JSON.

- [ ] Flows: classic workflows/BPF/desktop flows visualization; custom connectors; flow trigger conditions; infer Dataverse tables from entity set names.
- [ ] Dependencies: custom controls, plug-in steps/assemblies, option sets, ribbon commands per entity, form-to-form (quick view) references, Dataverse `RetrieveMissingDependencies` cross-check when a live environment is connected.
- [ ] Compare: saved comparisons, column filters/menus, virtualized rows, 3-way (base) compare, side-by-side XML diff.

## P2
- [ ] ERD view of a loaded solution (deep-link into D365 ERD Builder or embed).
- [ ] Group by publisher prefix with colors; relationship category filters.
- [ ] Table-level security matrix compare across roles; XLSX export.
- [ ] Accessibility pass (focus trap in dialogs, table semantics).

## Done
- [x] 0.5.0 Review adoption: zod payload validation, abuse limits, API guard, getClaims, withUser/log/env helpers, Status panel, export, privacy/terms/LICENSE, ESLint, native dialogs, login + contrast fixes (see docs/REVIEW-ADOPTION.md).
- [x] 0.4.0 Encrypted storage, FORCE RLS + revoked grants, nonce CSP + HSTS, allow-list, erase-all-data, docs/SECURITY.md.
- [x] 0.3.0 Missing-dependency engine, navigation analysis, flow visualizer + diff, Salesforce-Analyzer-style compare, import-order planner.
- [x] 0.2.0 Client-side unpack, richer schema parsing, security/field rules, ERD-Builder-style UI, CI.
- [x] 0.1.0 Parser, analyzer, compare, schema, API.
