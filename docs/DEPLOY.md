# Deploying

1. **Supabase**: create a project, apply `supabase/migrations/*.sql` (SQL editor or `supabase db push`), enable Email auth.
2. **Vercel**: import the GitHub repo; set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Note: Vercel functions accept ~4.5 MB request bodies, so uploads are capped at 4 MB. Larger packages need direct-to-Supabase-Storage upload (planned).

## Microsoft-supported practices applied
- Reads packages produced by the platform export or `pac solution export` (Power Platform CLI); no unsupported modification of packages.
- Patch rules follow Dataverse patch semantics: same major.minor as parent, higher build/revision, patch imported after parent, managed state matches.
- Recommends managed solutions for non-dev environments, custom publishers/prefixes, environment variable values via deployment settings, cloud flows over classic workflows.
