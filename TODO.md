# TODO

Legend: P0 first, P1 important, P2 nice-to-have.

## P0
- [ ] Provision Supabase project + apply migration; create Vercel project with env vars (needs owner approval).
- [ ] Validate parser/rules against several real exported solutions and patches (confirm patch XML markers).

## P1
- [ ] Strict CSP (nonce) + HSTS check in production.
- [ ] Import-order planner: topological order of loaded solutions from dependencies.
- [ ] Rules: plug-in step/isolation mode, forms/views referencing missing columns, option set conflicts, managed-property (`IsCustomizable`) checks.
- [ ] Insights tab (counts by publisher prefix, relationship categories, risk summary) like ERD Builder.
- [ ] Payloads >4 MB: chunked upload or Storage-backed JSON.

## P2
- [ ] ERD view of a loaded solution (deep-link into D365 ERD Builder or embed).
- [ ] Group by publisher prefix with colors; relationship category filters.
- [ ] Table-level security matrix compare across roles; XLSX export.
- [ ] Accessibility pass (focus trap in dialogs, table semantics).
- [ ] Rate limiting on API routes.

## Done
- [x] 0.2.0 Client-side unpack, richer schema parsing, security/field rules, ERD-Builder-style UI, CI.
- [x] 0.1.0 Parser, analyzer, compare, schema, API.
