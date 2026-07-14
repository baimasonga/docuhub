-- DESTRUCTIVE: drops every table this app owns, including all data.
-- Run this in the Supabase SQL Editor for the project you're about to set
-- up fresh, THEN re-run the migrations in order:
--   1. supabase/migrations/0001_relational_schema.sql
--   2. supabase/migrations/0002_secure_legacy_state_table.sql
--
-- Safe to run on an empty project (every DROP is IF EXISTS) or a project
-- that has partial/stale tables from an earlier attempt. Only touches
-- tables this app created -- does not touch Supabase's own schemas
-- (auth, storage, etc.) or any other tables you may have in `public`.

begin;

drop table if exists external_share_links cascade;
drop table if exists activity_logs cascade;
drop table if exists doc_comments cascade;
drop table if exists approval_requests cascade;
drop table if exists share_permissions cascade;
drop table if exists document_versions cascade;
drop table if exists documents cascade;
drop table if exists folders cascade;
drop table if exists dms_users cascade;
drop table if exists institutions cascade;

-- Legacy pre-relational datastore (single JSONB blob), if this project ever
-- had it.
drop table if exists docuhub_state cascade;

commit;
