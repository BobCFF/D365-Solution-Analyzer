# D365 Solution Analyzer

Upload Dynamics 365 / Dataverse solutions and patches (`.zip`), analyze them for import/deployment problems (missing dependencies, patch version errors, publisher issues, layering overlaps), and compare two solutions. Next.js on Vercel + Supabase (Postgres, Auth, RLS).

```
cp .env.example .env.local   # add Supabase URL + anon key + DATA_ENCRYPTION_KEY (see docs/SECURITY.md)
npm install && npm run dev
npm test && npm run typecheck
```

The `.zip` is unpacked in the browser; only parsed metadata is stored (see `PRIVACY.md`). UI and conventions follow [D365 ERD Builder](https://github.com/BobCFF/D365-ERD-Builder). Review triage: `docs/REVIEW-ADOPTION.md`. Licensed MIT. See `ARCHITECTURE.md`, `AGENTS.md`, `docs/DEPLOY.md`, `TODO.md`, `CHANGELOG.md`.
