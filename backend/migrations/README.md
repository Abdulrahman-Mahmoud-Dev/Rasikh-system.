# Rasikh PostgreSQL Migrations

Versioned SQL migrations for the Rasikh multi-tenant platform (`نظام راسخ`), aligned with **Rasikh Constitution 1.5** (`دستور نظام راسخ - 1.5`).

## Running Migrations

1. Configure `DATABASE_URL` in your local `backend/.env` (never commit `.env`).
2. From `backend/`:

```powershell
npm.cmd run db:migrate
```

For production/compiled builds:

```powershell
npm.cmd run db:migrate:built
```

## Guarantees

- **Lexical ordering**: Files must match `NNNN_description.sql` (`0001_...`, `0002_...`).
- **SHA-256 ledger**: Applied migrations and their checksums are recorded in `public.schema_migrations`.
- **Immutability**: Editing or deleting an already-applied migration causes the runner to abort immediately. Always add a new forward migration.
- **Advisory lock + transaction**: The runner acquires `pg_advisory_lock(731924650102)` so concurrent deployments cannot race, and commits each migration + ledger entry inside a single transaction.

## Constitution 1.5 Mapping & Intentionally Open Items

- **Hierarchy (`0001`)**: `associations` → `branches` (derived solely from `city`, `district`, `administrative_region`) → `quranic_premises` (`mosque` or `quranic_center`) → `circles` (`study_period`, optional `target_stage`, `operational_status`, without `circle_type`) → `students`.
- **Identity & Auth (`0002`)**: Unified `persons` with permanently reserved `AAA-123456` file numbers, separated from `user_accounts`, hashed `login_challenges`, hashed `auth_sessions`, `association_memberships`, scoped `role_assignments`, and single-use `invitations`.
- **Students, Transfers, Requests & Audit (`0003`)**: Exact student statuses (`active`, `temporarily_suspended`, `expelled`), DB-enforced single active enrollment per association, DB-trigger max 2 active guardians, multi-approver consensus requests, and append-only `audit_events` guarded by a mutation-blocking trigger.
- **Education & Sync (`0004`)**: Versioned Teacher Guide weights (`40/30/30` default), individual `education_plans`, `daily_attendance_records`, `daily_recitation_records` (114 Surahs), `monthly_student_summaries`, and hash-only `sync_operation_receipts`.
- **Open items intentionally NOT hardcoded**: Exact Mushaf page-to-ayah calculation standard, official Hijri conversion authority, PDPL legal retention schedules beyond the 30/60-day baseline, and offline conflict-resolution UI policies.
