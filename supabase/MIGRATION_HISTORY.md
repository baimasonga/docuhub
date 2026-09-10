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

Expected result: local and remote histories contain 0001–0008 and the two
`2026090209…` markers. Only migrations newer than those entries should appear
in the dry run. If any earlier migration still appears pending, stop and inspect
the ledger instead of using `--include-all` or editing production tables.

After reconciliation, all future remote schema changes must be applied from a
committed migration file. Do not use the production Dashboard SQL editor for
ad-hoc DDL.
