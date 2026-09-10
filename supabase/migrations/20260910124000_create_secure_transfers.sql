-- Multi-document, WeTransfer-style delivery packages. Files are not copied:
-- each item pins an immutable document_versions row.
begin;

create table if not exists public.secure_transfers (
  id text primary key,
  institution_id text not null references public.institutions(id),
  created_by text not null references public.dms_users(id),
  created_by_name text not null,
  title text not null check (char_length(title) between 1 and 160),
  message text,
  token text not null unique,
  short_code text not null unique,
  expires_at timestamptz not null,
  is_active boolean not null default true,
  access_count integer not null default 0 check (access_count >= 0),
  download_count integer not null default 0 check (download_count >= 0),
  max_downloads integer check (max_downloads between 1 and 10000),
  requires_password boolean not null default false,
  password_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not requires_password or password_hash is not null)
);

create table if not exists public.transfer_items (
  id text primary key,
  transfer_id text not null references public.secure_transfers(id) on delete cascade,
  document_id text not null references public.documents(id) on delete cascade,
  version_id text not null references public.document_versions(id) on delete cascade,
  file_name text not null,
  file_size bigint not null check (file_size >= 0),
  file_type text not null,
  created_at timestamptz not null default now(),
  unique (transfer_id, document_id)
);

create table if not exists public.transfer_recipients (
  id text primary key,
  transfer_id text not null references public.secure_transfers(id) on delete cascade,
  email text not null,
  sent_at timestamptz,
  first_accessed_at timestamptz,
  last_accessed_at timestamptz,
  download_count integer not null default 0 check (download_count >= 0),
  unique (transfer_id, email)
);

alter table public.secure_transfers enable row level security;
alter table public.transfer_items enable row level security;
alter table public.transfer_recipients enable row level security;

revoke all on public.secure_transfers, public.transfer_items, public.transfer_recipients
  from public, anon, authenticated;

create index if not exists secure_transfers_creator_idx
  on public.secure_transfers(created_by, created_at desc);
create index if not exists secure_transfers_institution_idx
  on public.secure_transfers(institution_id, created_at desc);
create index if not exists secure_transfers_lifecycle_idx
  on public.secure_transfers(expires_at) where is_active = true;
create index if not exists transfer_items_transfer_idx
  on public.transfer_items(transfer_id);
create index if not exists transfer_items_document_idx
  on public.transfer_items(document_id);
create index if not exists transfer_items_version_idx
  on public.transfer_items(version_id);
create index if not exists transfer_recipients_transfer_idx
  on public.transfer_recipients(transfer_id);

create or replace function public.docuhub_consume_transfer(
  p_id text,
  p_count_download boolean
) returns setof public.secure_transfers
language sql
security definer
set search_path = public
as $$
  update public.secure_transfers
  set access_count = access_count + 1,
      download_count = download_count + case when p_count_download then 1 else 0 end,
      updated_at = now()
  where id = p_id
    and is_active = true
    and expires_at > now()
    and (
      not p_count_download
      or max_downloads is null
      or download_count < max_downloads
    )
  returning *;
$$;

revoke all on function public.docuhub_consume_transfer(text, boolean)
  from public, anon, authenticated;
grant execute on function public.docuhub_consume_transfer(text, boolean)
  to service_role;

commit;
