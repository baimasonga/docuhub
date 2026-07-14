-- Chore Box DMS relational schema.
-- Replaces the legacy single-JSONB-row datastore (docuhub_state) with one
-- table per entity so concurrent server instances / Workers isolates can
-- write safely. The legacy table is kept; on first boot against an empty
-- schema the server imports it automatically (see server/store-supabase.ts).
--
-- All access goes through the service-role key (server-side only). RLS is
-- enabled with no policies so anon/authenticated clients cannot touch these
-- tables directly.

create table if not exists institutions (
  id text primary key,
  name text not null,
  units jsonb not null default '[]',
  category_folders jsonb not null default '{}',
  activity_dimension text not null default 'none'
);

create table if not exists dms_users (
  id text primary key,
  full_name text not null,
  email text not null,
  role text not null default 'Staff',
  department text not null default '',
  is_active boolean not null default true,
  institution_id text references institutions(id),
  password_hash text,
  must_change_password boolean not null default false,
  reset_token_hash text,
  reset_token_expires_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists dms_users_email_key on dms_users (lower(email));
create index if not exists dms_users_reset_token_idx on dms_users (reset_token_hash) where reset_token_hash is not null;

create table if not exists folders (
  id text primary key,
  name text not null,
  parent_folder_id text,
  owner_id text not null,
  department text,
  created_at timestamptz not null default now()
);
create index if not exists folders_parent_idx on folders (parent_folder_id);

create table if not exists documents (
  id text primary key,
  title text not null,
  description text not null default '',
  owner_id text not null,
  owner_name text not null default '',
  department text,
  folder_id text,
  document_type text not null default 'Other',
  status text not null default 'Draft',
  confidentiality_level text not null default 'Normal File',
  current_version text not null default 'v1',
  is_starred boolean not null default false,
  is_archived boolean not null default false,
  is_deleted boolean not null default false,
  tags jsonb not null default '[]',
  ocr_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Substring-search helper over the tags array (generated columns must be
  -- immutable, and jsonb -> text is).
  tags_text text generated always as (tags::text) stored,
  -- Weighted full-text index: title > description > owner/department/tags > OCR body.
  search_tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(owner_name, '') || ' ' || coalesce(department, '') || ' ' || coalesce(tags::text, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(ocr_text, '')), 'D')
  ) stored
);
create index if not exists documents_search_idx on documents using gin (search_tsv);
create index if not exists documents_folder_idx on documents (folder_id);
create index if not exists documents_owner_idx on documents (owner_id);
create index if not exists documents_state_idx on documents (is_deleted, is_archived, status);

create table if not exists document_versions (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  file_name text not null,
  file_size bigint not null default 0,
  file_type text,
  version_number text not null default 'v1',
  uploaded_by text not null,
  uploaded_by_name text not null default '',
  file_data text,
  storage_path text,
  created_at timestamptz not null default now()
);
create index if not exists document_versions_doc_idx on document_versions (document_id, created_at desc);

create table if not exists share_permissions (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  shared_with_user_id text not null,
  permission_type text not null default 'Viewer',
  shared_by_id text not null,
  created_at timestamptz not null default now(),
  unique (document_id, shared_with_user_id)
);
create index if not exists share_permissions_user_idx on share_permissions (shared_with_user_id);

create table if not exists approval_requests (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  requested_by text not null,
  requested_by_name text not null default '',
  approver_id text not null,
  approver_name text not null default '',
  status text not null default 'Pending Approval',
  request_comment text not null default '',
  approval_comment text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists approval_requests_approver_idx on approval_requests (approver_id, status);

create table if not exists doc_comments (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  user_id text not null,
  user_name text not null default '',
  user_role text not null default 'Viewer',
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists doc_comments_doc_idx on doc_comments (document_id, created_at);

-- Audit logs deliberately have NO document FK: they must survive a purge.
create table if not exists activity_logs (
  id text primary key,
  user_id text not null,
  user_name text not null default '',
  user_role text not null default 'Viewer',
  action text not null,
  document_id text,
  document_title text,
  details text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists activity_logs_created_idx on activity_logs (created_at desc);
create index if not exists activity_logs_doc_idx on activity_logs (document_id) where document_id is not null;

create table if not exists external_share_links (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  token text not null unique,
  short_code text unique,
  created_by text not null,
  permission_type text not null default 'Viewer',
  expires_at timestamptz not null,
  is_active boolean not null default true,
  access_count integer not null default 0,
  created_at timestamptz not null default now(),
  file_name text not null default '',
  file_size bigint not null default 0,
  file_type text,
  download_count integer not null default 0,
  max_downloads integer,
  message text,
  allow_download boolean not null default true,
  requires_password boolean not null default false,
  password_hash text
);

-- Service-role access only: enable RLS with no policies.
alter table institutions enable row level security;
alter table dms_users enable row level security;
alter table folders enable row level security;
alter table documents enable row level security;
alter table document_versions enable row level security;
alter table share_permissions enable row level security;
alter table approval_requests enable row level security;
alter table doc_comments enable row level security;
alter table activity_logs enable row level security;
alter table external_share_links enable row level security;
