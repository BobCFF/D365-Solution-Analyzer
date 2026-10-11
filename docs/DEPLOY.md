# Deploying

1. **Supabase**: create a project, apply `supabase/migrations/*.sql` (SQL editor or `supabase db push`), enable Email auth.
2. **Vercel**: import the GitHub repo; set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, **`DATA_ENCRYPTION_KEY`** (`echo "k1:$(openssl rand -base64 32)"`; mark as sensitive and back it up) and, for private deployments, `ALLOWED_EMAILS`. Follow `docs/SECURITY.md` for Supabase Auth settings (disable open sign-up, MFA).
3. Uploads are unpacked in the browser and only parsed JSON (limit ~4 MB) is posted, so large .zip files are fine; see TODO for very large schemas.

## Microsoft-supported practices applied
- Reads packages produced by the platform export or `pac solution export` (Power Platform CLI); no unsupported modification of packages.
- Patch rules follow Dataverse patch semantics: same major.minor as parent, higher build/revision, patch imported after parent, managed state matches.
- Recommends managed solutions for non-dev environments, custom publishers/prefixes, environment variable values via deployment settings, cloud flows over classic workflows.
