# CLAUDE.md - D365 Solution Analyzer

Read `AGENTS.md` (working rules) and `ARCHITECTURE.md` (file map) before changing code. Conventions are shared with the sibling project **D365 ERD Builder** so both tools feel like one family.

## Non-negotiables
- Solution packages are unpacked **in the browser**; the server only receives parsed metadata (`validateParsed` bounds and checks it). Never upload or store the raw .zip or file contents.
- Stick to Microsoft-supported behaviour: read standard exports (Power Apps / `pac solution export`); never advise editing managed layers or unsupported XML hacks.
- Every user-visible change: bump `version` in `package.json`, add a `CHANGELOG.md` entry (CI checks), update `TODO.md`, then PR -> squash-merge to `main`.
- Never commit secrets or a model identifier.
