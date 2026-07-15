-- File History / audit trail: track when a document was last formally
-- audited by a Manager, Admin, or Auditor, and by whom. A document "needs
-- audit" (computed in the app, not stored) when this is null or older than
-- the document's updated_at.
alter table documents
  add column if not exists last_audited_at timestamptz,
  add column if not exists last_audited_by text references dms_users(id) on delete set null,
  add column if not exists last_audited_by_name text;
