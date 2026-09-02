-- Trash retention. `is_deleted` recorded *that* a document was trashed but not
-- *when*, so nothing could expire and Trash grew without bound. Record the
-- moment of the soft delete and let the nightly job purge anything past the
-- retention window (TRASH_RETENTION_DAYS, default 30, 0 disables).
begin;

alter table documents
  add column if not exists deleted_at timestamptz;

-- Documents already sitting in Trash have no recorded deletion time. Date them
-- from their last update rather than from this migration, so a document that
-- has been in Trash for a year is not granted a fresh retention window.
update documents set deleted_at = updated_at where is_deleted and deleted_at is null;

-- The purge job scans only trashed rows, so keep the index to that subset.
create index if not exists documents_trash_expiry_idx
  on documents (deleted_at) where is_deleted;

commit;
