# Security

Solution files describe a customer's data model, security roles, integrations and navigation, so they are treated as confidential.

## What is protected, and how
| Threat | Control |
|---|---|
| Database access / backups / SQL logs expose customer metadata | **Application-level encryption** (AES-256-GCM) of every content-bearing value *before* it reaches Supabase: solution metadata, the parsed model, finding text, comparison results and the audit log. `CHECK (... like 'enc:v1:%')` constraints make storing plaintext in those columns impossible. |
| One user reading another's data | Row-level security (owner only, `FORCE`d), no `anon`/`public` grants, and **per-user encryption keys** (HKDF from the master key, bound to the user id and column via AAD). Ciphertext copied to another user's row fails authentication. |
| Raw solution files leaking | The `.zip` is unpacked in the browser and never uploaded; web resources, plug-in binaries and flow expressions/parameter values are not stored. Duplicate detection uses keyed hashes, not plain names or file hashes. |
| Tampering with stored data | GCM authentication: modified ciphertext is rejected, never silently decrypted. |
| Key compromise / rotation | Key ids in every envelope; `DATA_ENCRYPTION_KEYS_PREVIOUS` keeps old keys readable while `DATA_ENCRYPTION_KEY` encrypts new writes. The app **fails closed** (refuses to store) if no key is configured. |
| Unauthorised accounts | JWT validated against Supabase Auth on every request; optional `ALLOWED_EMAILS` allow-list; disable public sign-up in Supabase for private deployments. |
| XSS / data exfiltration from the page | Nonce-based CSP (no inline/eval/third-party scripts; `connect-src` limited to self + your Supabase), no framing, `nosniff`, no-referrer, HSTS, CORP/COOP. React escapes all rendered values; CSV exports neutralise spreadsheet formulas. |
| Abuse / denial of wallet | Hourly limits on upload/analyze/compare (durable, counted from the user's own audit log), per-instance limits on heavy reads and export, a 200-solution quota, a 4 MB body cap and a zod schema that bounds every string and array. |
| Cross-site request forgery | Auth is a Bearer header (never an ambient cookie); middleware additionally refuses cross-site `Origin` and non-JSON bodies on API writes. |
| Malformed or hostile uploads | Deep zod validation; unknown keys are dropped; the analyzer only ever sees a validated structure. |
| Caching of decrypted responses | `Cache-Control: no-store` on all API routes. |
| Error leakage | API errors are generic; details go to server logs only (never include customer data in logs). |
| Right to erasure | Settings: **Change log > Delete all my data** (`DELETE /api/account`) removes every row the user owns. |

## Dynamics 365 connections (v0.12.0)
- Service-principal secrets are the most sensitive thing the app holds. They are sealed like everything else (AAD-bound to the user and column), exist in plaintext only inside the server routes that sign in, and are excluded from API responses, logs, errors and the data export.
- Use a dedicated Entra app registration per environment, grant its application user a **read-only** custom security role, and rotate the secret regularly. The app only ever sends GET requests (and the token request to Microsoft Entra).
- SSRF/credential-exfiltration guard: only `https://<org>.crm[N].dynamics.com|.dynamics.cn|.microsoftdynamics.us|.appsplatform.us` hosts are accepted (validated on save and on every call); the sign-in authority is derived from that cloud, never user-supplied; redirects are not followed; `@odata.nextLink` is followed only inside the same environment; query values are validated against an allow-list pattern and quote-escaped.
- Rate limits: 10 tests/min, 6 verifications/min and 60/hour per user; at most 10 saved connections.

## What is *not* encrypted (by design)
Row ids, owner id, timestamps, finding rule id + severity (e.g. `DEP101`, `error`), audit action type, app version, and row counts. These identify no customer component.

## Operating it safely
1. Generate the key: `echo "k1:$(openssl rand -base64 32)"`; store it only in Vercel's encrypted env vars and your secrets manager. **Without it data cannot be decrypted.** Never commit it or paste it into chat.
2. Use a dedicated Supabase project per trust boundary; enable MFA for dashboard users; keep the service-role key out of this app (it is never used; RLS is always enforced as the signed-in user).
3. In Supabase Auth: disable "Allow new users to sign up" (or set `ALLOWED_EMAILS`), require email confirmation, enable leaked-password protection and MFA.
4. Enable Supabase backups/PITR as usual: backups only contain ciphertext.
5. Rotate: set a new `DATA_ENCRYPTION_KEY`, move the old value to `DATA_ENCRYPTION_KEYS_PREVIOUS`, redeploy. (Bulk re-encryption of old rows is on the TODO list; until then keep previous keys.)
6. Keep dependencies patched (CI runs `npm audit`).

## Self-check
The **Status** panel (Change log tab, `GET /api/health`) shows configuration problems, whether the migration is applied, an encryption self-test and whether `ALLOWED_EMAILS` is set. The same problems are logged at startup. Logs are structured JSON with secrets and sealed values scrubbed, and never contain solution content.

## Reporting
Please report vulnerabilities privately to the repository owner rather than in a public issue.
