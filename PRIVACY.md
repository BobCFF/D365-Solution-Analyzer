# Privacy

- The solution `.zip` is unpacked **in your browser** and never uploaded. File contents (web resources, plug-in assemblies, canvas app packages) are not read or stored, and flow **expressions and parameter values are discarded** (only step names, types and connector/operation names are kept).
- What is stored (Supabase Postgres, your own account only): solution names/versions, publisher, component lists, table/column schema, security role and field-profile summaries, navigation trees, cloud flow structure, analysis findings, comparison results and an audit log of your actions. Customer *data* is never part of a solution file.
- **All of the above is encrypted by the application with AES-256-GCM, using a key derived per user, before it is written to the database.** Database administrators, backups and logs only see ciphertext; only the running app (holding the server-side key) can decrypt it, and only for the signed-in owner. See `docs/SECURITY.md`.
- Not encrypted: ids, timestamps, rule ids and severities, audit action types. None identify a customer component.
- **Erase everything any time:** Change log > *Delete all my data*. Deleting a single solution (Solutions tab) removes it and its findings; the audit log keeps a one-line sealed record.
- Your view settings (last page, selected solution id, filters and search text, sort order, column layouts) and theme are kept in this browser's `localStorage`, per account, and are never sent to the server. Clear them with Change log > *Reset saved view settings* (or by clearing site data). No analytics or third-party scripts (enforced by the Content-Security-Policy).
- Treat schema metadata as confidential; use a dedicated Supabase project for each trust boundary.
