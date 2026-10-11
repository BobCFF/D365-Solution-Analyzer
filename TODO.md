# TODO

Legend: P0 first, P1 important, P2 nice-to-have.

## P0
- [ ] Provision Supabase project + apply migration; create Vercel project with env vars (needs owner approval).
- [ ] Validate parser/rules against several real exported solutions and patches (confirm patch XML markers).

## P1
- [ ] Strict CSP (nonce) + HSTS check in production.
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
- [ ] Rate limiting on API routes.

## Done
- [x] 0.3.0 Missing-dependency engine, navigation analysis, flow visualizer + diff, Salesforce-Analyzer-style compare, import-order planner.
- [x] 0.2.0 Client-side unpack, richer schema parsing, security/field rules, ERD-Builder-style UI, CI.
- [x] 0.1.0 Parser, analyzer, compare, schema, API.
