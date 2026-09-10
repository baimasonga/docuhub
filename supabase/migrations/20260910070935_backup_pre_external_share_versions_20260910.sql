-- Production history marker only.
--
-- A restricted rollback snapshot was created in production immediately before
-- pinning external share links to immutable document versions. The snapshot is
-- stored in schema docuhub_backup_20260910_pre_external_links. This no-op file
-- keeps local migration history aligned without recreating the snapshot.
select 1;
