# Database migrations

Migrations are versioned SQL files. The runner applies them in lexical order and records each SHA-256 checksum in `public.schema_migrations`.

## Local use

1. Set `DATABASE_URL` in the ignored `backend/.env` file. Do not commit that file.
2. From the `backend` directory, run:

   ```powershell
   npm.cmd run db:migrate
   ```

The runner takes a PostgreSQL advisory lock so two deploys cannot apply migrations at the same time. Each migration and its ledger entry are committed in the same database transaction. It refuses to run if an already-applied migration file was edited or removed.

## Adding a migration

- Add a new file such as `0002_attendance_records.sql`.
- Never edit a migration that has already been applied to any shared database; add a later migration instead.
- Review the SQL and run it first against a disposable local database, then a staging database with a recent backup.
- The API server does not run migrations on startup. Migration execution is an explicit deployment step.

This first migration establishes tenant-safe relationships and the server-side idempotency receipt ledger. It does not create the finalized attendance or recitation tables; those depend on the approved educational fields and correction rules. The receipt table deliberately stores a payload hash and outcome only, not the offline personal data payload.
