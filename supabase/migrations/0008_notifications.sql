-- In-app notifications. Shares, approval requests and approval decisions were
-- announced by email only, so an institution running without RESEND_API_KEY
-- (it is optional) had no way at all to tell someone a document was waiting
-- for them.
begin;

create table if not exists notifications (
  id text primary key,
  user_id text not null references dms_users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null default '',
  -- The document the notification points at. Nulled rather than cascaded on
  -- purge so the message survives as a record of what happened.
  document_id text references documents(id) on delete set null,
  actor_name text not null default '',
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- The only read pattern: one user's newest notifications, unread first.
create index if not exists notifications_user_created_idx
  on notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on notifications (user_id) where not is_read;

commit;
