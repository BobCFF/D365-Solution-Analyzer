# D365 Solution Analyzer

Upload Dynamics 365 / Dataverse solutions and patches (`.zip`), analyze them for import/deployment problems (missing dependencies, patch version errors, publisher issues, layering overlaps), and compare two solutions. Next.js on Vercel + Supabase (Postgres, Auth, RLS).

```
cp .env.example .env.local   # add Supabase URL + anon key
npm install && npm run dev
npm test && npm run typecheck
```

See `docs/DEPLOY.md` and `CHANGELOG.md`.
