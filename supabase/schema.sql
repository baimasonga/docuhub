-- DocuHub production schema foundation.
-- Run in Supabase SQL editor after enabling Auth providers and creating the
-- private Storage bucket named "documents".

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('Admin','Manager','Staff','Viewer','Auditor')),
  department text not null default 'General',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('Admin','Manager','Staff','Viewer','Auditor')),
  department text not null default 'General',
  token_hash text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_folder_id uuid references public.folders(id) on delete cascade,
  name text not null,
  department text,
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete set null,
  owner_id uuid references auth.users(id) on delete set null,
  title text not null,
  description text not null default '',
  document_type text not null default 'Other',
  department text,
  status text not null default 'Draft',
  confidentiality_level text not null default 'Normal File',
  is_starred boolean not null default false,
  is_archived boolean not null default false,
  is_deleted boolean not null default false,
  tags text[] not null default '{}',
  ocr_text text,
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '),'')), 'B') ||
    setweight(to_tsvector('english', coalesce(ocr_text,'')), 'C') ||
    setweight(to_tsvector('english', coalesce(description,'')), 'D')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_search_idx on public.documents using gin(search_vector);
create index if not exists documents_org_idx on public.documents(organization_id);

create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  version_number text not null,
  file_name text not null,
  file_size bigint not null,
  file_type text not null,
  storage_path text not null,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.document_permissions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  shared_with uuid not null references auth.users(id) on delete cascade,
  permission_type text not null check (permission_type in ('Viewer','Commenter','Editor','Approver')),
  shared_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  approver_id uuid references auth.users(id) on delete cascade,
  status text not null default 'Pending Approval',
  request_comment text not null default '',
  approval_comment text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  text text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  document_id uuid references public.documents(id) on delete set null,
  details text not null,
  created_at timestamptz not null default now()
);

create or replace function public.is_org_member(org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = auth.uid()
  );
$$;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.invitations enable row level security;
alter table public.folders enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_permissions enable row level security;
alter table public.approvals enable row level security;
alter table public.comments enable row level security;
alter table public.audit_logs enable row level security;

create policy "members can view their organizations" on public.organizations for select using (public.is_org_member(id));
create policy "members can view org members" on public.organization_members for select using (public.is_org_member(organization_id));
create policy "members can view folders" on public.folders for select using (public.is_org_member(organization_id));
create policy "members can manage folders" on public.folders for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members can view documents" on public.documents for select using (public.is_org_member(organization_id));
create policy "members can manage documents" on public.documents for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members can view audit logs" on public.audit_logs for select using (public.is_org_member(organization_id));
