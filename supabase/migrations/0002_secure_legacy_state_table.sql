-- Defense in depth for projects that were used with the pre-relational
-- single-JSONB-blob datastore before 0001_relational_schema.sql. That table
-- (docuhub_state) predates this migration and was never RLS-protected, so on
-- a project that has it, the entire legacy blob -- every document, user, and
-- OCR text that ever existed -- is readable by the anon/authenticated
-- Postgres roles by default. server/store-supabase.ts only reads it once, on
-- first boot, to import old data; the app itself never needs client-side
-- access to it. `if exists` makes this a no-op on a project that never had
-- the table.
alter table if exists public.docuhub_state enable row level security;
