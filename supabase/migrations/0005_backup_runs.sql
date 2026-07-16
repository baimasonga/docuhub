-- External backup runs (e.g. to iDrive e2 or another S3-compatible target).
-- One row per run; incremental backups use the most recent 'success' row's
-- started_at as the cutoff for "what's changed since last time".
create table if not exists backup_runs (
  id text primary key,
  trigger text not null check (trigger in ('manual', 'scheduled')),
  triggered_by_name text,
  status text not null check (status in ('running', 'success', 'error')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  files_uploaded integer not null default 0,
  bytes_uploaded bigint not null default 0,
  error text
);
create index if not exists backup_runs_started_idx on backup_runs (started_at desc);

alter table backup_runs enable row level security;
-- Service-role only (same backstop pattern as every other table here): no
-- policies means only the service-role key -- used exclusively server-side --
-- can read/write. Anonymous/authenticated Supabase clients get nothing.
