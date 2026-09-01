-- Security and tenant-isolation hardening.
begin;

alter table dms_users add column if not exists session_version bigint not null default 0;

alter table folders add column if not exists institution_id text;
update folders f set institution_id = u.institution_id
from dms_users u where f.owner_id = u.id and f.institution_id is null;
update folders set institution_id = (select id from institutions order by id limit 1)
where institution_id is null;
alter table folders alter column institution_id set not null;
alter table folders drop constraint if exists folders_institution_id_fkey;
alter table folders add constraint folders_institution_id_fkey
  foreign key (institution_id) references institutions(id);
create index if not exists folders_institution_idx on folders(institution_id, parent_folder_id);

alter table documents add column if not exists institution_id text;
update documents d set institution_id = u.institution_id
from dms_users u where d.owner_id = u.id and d.institution_id is null;
update documents set institution_id = (select id from institutions order by id limit 1)
where institution_id is null;
alter table documents alter column institution_id set not null;
alter table documents drop constraint if exists documents_institution_id_fkey;
alter table documents add constraint documents_institution_id_fkey
  foreign key (institution_id) references institutions(id);
create index if not exists documents_institution_idx on documents(institution_id, created_at desc);

create table if not exists document_stars (
  user_id text not null references dms_users(id) on delete cascade,
  document_id text not null references documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, document_id)
);
alter table document_stars enable row level security;
insert into document_stars(user_id, document_id)
select owner_id, id from documents where is_starred = true
on conflict do nothing;

create table if not exists auth_rate_limits (
  rate_key text primary key,
  attempt_count integer not null default 0,
  window_start timestamptz not null default now()
);
alter table auth_rate_limits enable row level security;

create or replace function docuhub_check_rate_limit(
  p_key text, p_window_seconds integer, p_max_attempts integer
) returns boolean language plpgsql security definer set search_path = public as $$
declare current_row auth_rate_limits%rowtype;
begin
  select * into current_row from auth_rate_limits where rate_key = p_key for update;
  if not found then
    insert into auth_rate_limits(rate_key, attempt_count, window_start) values (p_key, 1, now());
    return false;
  end if;
  if current_row.window_start < now() - make_interval(secs => p_window_seconds) then
    update auth_rate_limits set attempt_count = 1, window_start = now() where rate_key = p_key;
    return false;
  end if;
  update auth_rate_limits set attempt_count = attempt_count + 1 where rate_key = p_key;
  return current_row.attempt_count + 1 > p_max_attempts;
end;
$$;
revoke all on function docuhub_check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function docuhub_check_rate_limit(text, integer, integer) to service_role;

create or replace function docuhub_consume_external_link(p_id text, p_count_download boolean)
returns setof external_share_links language sql security definer set search_path = public as $$
  update external_share_links
  set access_count = access_count + 1,
      download_count = download_count + case when p_count_download then 1 else 0 end
  where id = p_id and is_active = true and expires_at > now()
    and (not p_count_download or max_downloads is null or download_count < max_downloads)
  returning *;
$$;
revoke all on function docuhub_consume_external_link(text, boolean) from public, anon, authenticated;
grant execute on function docuhub_consume_external_link(text, boolean) to service_role;

alter table share_permissions drop constraint if exists share_permissions_type_check;
alter table share_permissions add constraint share_permissions_type_check
  check (permission_type in ('Viewer', 'Commenter', 'Editor', 'Approver')) not valid;
alter table external_share_links drop constraint if exists external_links_max_downloads_check;
alter table external_share_links add constraint external_links_max_downloads_check
  check (max_downloads is null or max_downloads > 0) not valid;

-- Unique indexes, unlike an existence-check trigger, remain correct when
-- concurrent transactions try to claim the same version label or object.
-- Stop with an actionable error if legacy data must be repaired first; never
-- discard or relabel document history automatically.
do $$
begin
  if exists (
    select 1 from document_versions
    group by document_id, version_number having count(*) > 1
  ) then
    raise exception 'Legacy duplicate document version numbers must be repaired before migration 0006';
  end if;
  if exists (
    select 1 from document_versions where storage_path is not null
    group by storage_path having count(*) > 1
  ) then
    raise exception 'Legacy shared storage paths must be copied to independent objects before migration 0006';
  end if;
end;
$$;
drop trigger if exists document_versions_no_duplicates on document_versions;
drop function if exists prevent_duplicate_document_version();
create unique index if not exists document_versions_doc_version_key
  on document_versions(document_id, version_number);
create unique index if not exists document_versions_storage_path_key
  on document_versions(storage_path) where storage_path is not null;

commit;
