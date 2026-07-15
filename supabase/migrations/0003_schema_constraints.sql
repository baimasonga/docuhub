-- Adds the foreign keys and enum CHECK constraints that 0001 shipped
-- without (flagged in review but deferred until there was a live schema to
-- verify against). Safe to run now: the app already keeps these columns
-- consistent at the application level, this migration just makes Postgres
-- enforce it too.
--
-- FK ON DELETE behavior: deliberately left as the default (NO ACTION,
-- checked at end-of-statement). This matches how the app already deletes
-- data:
--   - DELETE /api/folders/:id clears documents.folder_id to null (a
--     separate statement) BEFORE deleting the folder rows, and deletes an
--     entire folder subtree in one `DELETE ... WHERE id IN (...)`
--     statement -- so by the time FK checks run, no remaining row
--     (document or sibling folder) still points at a deleted folder.
--   - There is no user-deletion endpoint (only deactivate), so the
--     owner_id/approver_id/etc. FKs never get exercised by a delete today;
--     NO ACTION just means a future "delete user" feature can't silently
--     orphan documents/folders/approvals without an explicit decision.
--
-- doc_comments.user_id and activity_logs.user_id are deliberately left
-- unconstrained, matching 0001's own stated philosophy for activity_logs
-- ("must survive a purge") -- audit-trail-shaped data shouldn't be able to
-- block an unrelated delete elsewhere.

begin;

alter table folders
  add constraint folders_owner_id_fkey foreign key (owner_id) references dms_users(id),
  add constraint folders_parent_folder_id_fkey foreign key (parent_folder_id) references folders(id);

alter table documents
  add constraint documents_owner_id_fkey foreign key (owner_id) references dms_users(id),
  add constraint documents_folder_id_fkey foreign key (folder_id) references folders(id);

alter table share_permissions
  add constraint share_permissions_shared_with_user_id_fkey foreign key (shared_with_user_id) references dms_users(id),
  add constraint share_permissions_shared_by_id_fkey foreign key (shared_by_id) references dms_users(id);

alter table approval_requests
  add constraint approval_requests_requested_by_fkey foreign key (requested_by) references dms_users(id),
  add constraint approval_requests_approver_id_fkey foreign key (approver_id) references dms_users(id);

alter table dms_users
  add constraint dms_users_role_check check (role in ('Admin', 'Manager', 'Staff', 'Viewer', 'Auditor'));

alter table documents
  add constraint documents_status_check check (status in ('Draft', 'Pending Approval', 'Changes Requested', 'Approved', 'Rejected')),
  add constraint documents_confidentiality_level_check check (confidentiality_level in ('Normal File', 'Official Record', 'Confidential', 'Archive')),
  add constraint documents_document_type_check check (document_type in ('Contract', 'Invoice', 'Memo', 'Report', 'Support', 'Other'));

alter table approval_requests
  add constraint approval_requests_status_check check (status in ('Draft', 'Pending Approval', 'Changes Requested', 'Approved', 'Rejected'));

commit;
