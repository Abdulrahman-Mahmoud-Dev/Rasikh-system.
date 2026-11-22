import "dotenv/config";

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool, type PoolClient } from "pg";
import { z } from "zod";

const databaseUrlSchema = z
  .string()
  .url()
  .startsWith("postgresql://", "DATABASE_URL must be a PostgreSQL connection URL");

const databaseUrl = databaseUrlSchema.safeParse(process.env.DATABASE_URL);

if (!databaseUrl.success) {
  throw new Error(
    "Database migrations need a valid DATABASE_URL in the environment or backend/.env.",
  );
}

const migrationDirectory = fileURLToPath(
  new URL("../../migrations/", import.meta.url),
);

const migrationFilenamePattern = /^\d{4}_[a-z0-9_]+\.sql$/;
const advisoryLockKey = "731924650102";

type AppliedMigration = {
  version: string;
  checksum: string;
};

type MigrationFile = {
  version: string;
  filename: string;
  contents: string;
  checksum: string;
};

const pool = new Pool({
  connectionString: databaseUrl.data,
  max: 1,
  connectionTimeoutMillis: 5_000,
});

let client: PoolClient | undefined;
let lockAcquired = false;

const loadMigrations = async (): Promise<MigrationFile[]> => {
  const entries = await readdir(migrationDirectory, { withFileTypes: true });
  const sqlFilenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  for (const filename of sqlFilenames) {
    if (!migrationFilenamePattern.test(filename)) {
      throw new Error(
        `Migration filename "${filename}" must use the format NNNN_name.sql.`,
      );
    }
  }

  return Promise.all(
    sqlFilenames.map(async (filename) => {
      const contents = await readFile(
        join(migrationDirectory, filename),
        "utf8",
      );

      return {
        filename,
        version: filename.slice(0, -".sql".length),
        contents,
        checksum: createHash("sha256").update(contents, "utf8").digest("hex"),
      };
    }),
  );
};

const main = async (): Promise<void> => {
  client = await pool.connect();

  await client.query("SELECT pg_advisory_lock($1::bigint)", [advisoryLockKey]);
  lockAcquired = true;

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version text PRIMARY KEY,
      checksum char(64) NOT NULL
        CHECK (checksum ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const migrations = await loadMigrations();
  const appliedResult = await client.query<AppliedMigration>(
    "SELECT version, checksum FROM public.schema_migrations ORDER BY version",
  );
  const applied = new Map(
    appliedResult.rows.map((migration) => [
      migration.version,
      migration.checksum.trim(),
    ]),
  );
  const availableVersions = new Set(migrations.map(({ version }) => version));

  for (const version of applied.keys()) {
    if (!availableVersions.has(version)) {
      throw new Error(
        `Migration "${version}" is recorded in the database but missing from backend/migrations.`,
      );
    }
  }

  for (const migration of migrations) {
    const existingChecksum = applied.get(migration.version);

    if (existingChecksum) {
      if (existingChecksum !== migration.checksum) {
        throw new Error(
          `Applied migration "${migration.version}" was changed. Add a new migration instead of editing it.`,
        );
      }

      continue;
    }

    await client.query("BEGIN");

    try {
      await client.query(migration.contents);
      await client.query(
        `INSERT INTO public.schema_migrations (version, checksum)
         VALUES ($1, $2)`,
        [migration.version, migration.checksum],
      );
      await client.query("COMMIT");
      console.info(`Applied database migration ${migration.version}.`);
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original migration error.
      }

      throw error;
    }
  }

  console.info("Database migrations are up to date.");
};

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown migration error.";
  console.error(`Database migration failed: ${message}`);
  process.exitCode = 1;
} finally {
  if (client && lockAcquired) {
    try {
      await client.query("SELECT pg_advisory_unlock($1::bigint)", [
        advisoryLockKey,
      ]);
    } catch {
      process.exitCode = 1;
    }
  }

  client?.release();
  await pool.end();
}
