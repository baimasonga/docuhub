-- Production migration-history marker.
--
-- The live project records this timestamp for the verified rollback snapshot
-- created before security hardening. The snapshot itself lives in the
-- docuhub_backup_20260902_094749 schema; there is no schema change to replay.
select 1;
