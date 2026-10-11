# Privacy

- The solution `.zip` is unpacked **in your browser** and never uploaded. File contents (web resources, plug-in assemblies, flows, canvas app packages) are not read or stored.
- What is stored, in your own account only (Supabase Postgres, row-level security by owner): solution names/versions, publisher, component lists, table/column schema, security role and field-profile summaries, analysis findings, and an audit log of your actions. Customer *data* is never part of a solution file.
- Delete a solution (Solutions tab) to remove it and its findings; the audit log keeps a one-line record of the deletion.
- Theme preference is kept in `localStorage`. No analytics or third-party scripts.
- Treat schema metadata as confidential; use a dedicated Supabase project for each trust boundary.
