# Production migration-history reconciliation

The live DocuHub project was partly initialized before the repository adopted
one consistent Supabase CLI workflow. Its schema contains migrations 0001–0008,
but the remote ledger records only the pre-hardening backup and migration 0006
under generated timestamps.

Do not run `supabase db push` against production until the ledger is repaired.
First verify the production schema and back it up. Then, from a workstation
linked to project `vwpibqvwzvqccoqceumv`, run:

```bash
supabase migration list
supabase migration repair 0001 0002 0003 0004 0005 0006 0007 0008 --status applied
supabase migration list
supabase db push --dry-run
```

The repository includes no-op files for the two generated timestamps already
present in production. They describe existing history; they do not recreate or
overwrite the rollback snapshot.

Production reconciliation was completed on 2026-09-10 after a verified rollback
snapshot. Local and remote histories now contain 0001–0008, the two
`2026090209…` markers, backup marker `20260910070935`, and the external-link
version migration `20260910071105`. If any earlier migration appears pending,
stop and inspect the ledger instead of using `--include-all` or rerunning it.

After reconciliation, all future remote schema changes must be applied from a
committed migration file. Do not use the production Dashboard SQL editor for
ad-hoc DDL.
