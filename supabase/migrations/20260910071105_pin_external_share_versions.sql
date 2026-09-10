-- Pin every external link to the exact document version selected when the
-- link is created. Without this, an old public link silently begins serving a
-- newer upload while still displaying the old filename and size.
begin;

alter table public.external_share_links
  add column if not exists version_id text;

-- Existing links historically served the newest version. Preserve the file
-- they serve at migration time, then make the snapshot mandatory for all new
-- writes. Abort rather than leaving ambiguous links if legacy data is broken.
update public.external_share_links link
set version_id = (
  select dv.id
  from public.document_versions dv
  where dv.document_id = link.document_id
  order by dv.created_at desc, dv.id desc
  limit 1
)
where link.version_id is null;

do $$
begin
  if exists (select 1 from public.external_share_links where version_id is null) then
    raise exception 'Cannot pin external links: one or more linked documents have no version';
  end if;
end
$$;

alter table public.external_share_links
  alter column version_id set not null;

alter table public.external_share_links
  drop constraint if exists external_share_links_version_id_fkey;
alter table public.external_share_links
  add constraint external_share_links_version_id_fkey
  foreign key (version_id) references public.document_versions(id) on delete cascade;

create index if not exists external_share_links_document_id_idx
  on public.external_share_links(document_id);
create index if not exists external_share_links_version_id_idx
  on public.external_share_links(version_id);
create index if not exists external_share_links_lifecycle_idx
  on public.external_share_links(expires_at)
  where is_active = true;

-- Cover DocuHub foreign keys used by joins, cascades and lifecycle jobs. The
-- reporting/indicator subsystem in this shared project is intentionally not
-- altered by this application migration.
create index if not exists approval_requests_document_id_idx
  on public.approval_requests(document_id);
create index if not exists approval_requests_requested_by_idx
  on public.approval_requests(requested_by);
create index if not exists dms_users_institution_id_idx
  on public.dms_users(institution_id);
create index if not exists document_stars_document_id_idx
  on public.document_stars(document_id);
create index if not exists documents_last_audited_by_idx
  on public.documents(last_audited_by) where last_audited_by is not null;
create index if not exists folders_owner_id_idx
  on public.folders(owner_id);
create index if not exists notifications_document_id_idx
  on public.notifications(document_id) where document_id is not null;
create index if not exists share_permissions_shared_by_id_idx
  on public.share_permissions(shared_by_id);

-- Close already-expired rows without deleting their audit history.
update public.external_share_links
set is_active = false
where is_active = true
  and (
    expires_at <= now()
    or (max_downloads is not null and download_count >= max_downloads)
  );

commit;
