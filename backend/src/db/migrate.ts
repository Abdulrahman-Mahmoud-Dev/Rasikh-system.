import "dotenv/config";

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Pool, type PoolClient } from "pg";
import { z } from "zod";

export const DEFAULT_MIGRATION_DIR = fileURLToPath(
  new URL("../../migrations/", import.meta.url),
);

const MIGRATION_FILENAME_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;
const ADVISORY_LOCK_KEY = "731924650102";

export interface MigrationFile {
  version: string;
  filename: string;
  contents: string;
  checksum: string;
}

interface AppliedMigrationRow {
  version: string;
  checksum: string;
}

export interface MigrationRunResult {
  applied: string[];
  skipped: string[];
}

export async function loadMigrations(
  directory: string = DEFAULT_MIGRATION_DIR,
): Promise<MigrationFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sqlFilenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  for (const filename of sqlFilenames) {
    if (!MIGRATION_FILENAME_PATTERN.test(filename)) {
      throw new Error(
        `Migration filename "${filename}" must use the format NNNN_name.sql.`,
      );
    }
  }

  return Promise.all(
    sqlFilenames.map(async (filename) => {
      const contents = await readFile(join(directory, filename), "utf8");
      return {
        filename,
        version: filename.slice(0, -".sql".length),
        contents,
        checksum: createHash("sha256").update(contents, "utf8").digest("hex"),
      };
    }),
  );
}

export async function runMigrations(
  pool: Pool,
  options?: { migrationDir?: string },
): Promise<MigrationRunResult> {
  const migrationDir = options?.migrationDir ?? DEFAULT_MIGRATION_DIR;
  let client: PoolClient | undefined;
  let lockAcquired = false;
  const appliedVersions: string[] = [];
  const skippedVersions: string[] = [];

  try {
    client = await pool.connect();

    await client.query("SELECT pg_advisory_lock($1::bigint)", [
      ADVISORY_LOCK_KEY,
    ]);
    lockAcquired = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version text PRIMARY KEY,
        checksum char(64) NOT NULL
          CHECK (checksum ~ '^[0-9a-f]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const migrations = await loadMigrations(migrationDir);
    const appliedResult = await client.query<AppliedMigrationRow>(
      "SELECT version, checksum FROM public.schema_migrations ORDER BY version",
    );

    const appliedMap = new Map(
      appliedResult.rows.map((row) => [row.version, row.checksum.trim()]),
    );
    const availableVersions = new Set(migrations.map((m) => m.version));

    for (const version of appliedMap.keys()) {
      if (!availableVersions.has(version)) {
        throw new Error(
          `Migration "${version}" is recorded in the database but missing from ${migrationDir}.`,
        );
      }
    }

    for (const migration of migrations) {
      const existingChecksum = appliedMap.get(migration.version);

      if (existingChecksum) {
        if (existingChecksum !== migration.checksum) {
          throw new Error(
            `Applied migration "${migration.version}" was modified. Create a new forward migration instead.`,
          );
        }
        skippedVersions.push(migration.version);
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
        appliedVersions.push(migration.version);
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve original migration failure.
        }
        throw error;
      }
    }

    return { applied: appliedVersions, skipped: skippedVersions };
  } finally {
    if (client && lockAcquired) {
      try {
        await client.query("SELECT pg_advisory_unlock($1::bigint)", [
          ADVISORY_LOCK_KEY,
        ]);
      } catch {
        // Ignore unlock errors during teardown.
      }
    }
    client?.release();
  }
}

async function runCli(): Promise<void> {
  const databaseUrlSchema = z
    .string()
    .url()
    .startsWith(
      "postgresql://",
      "DATABASE_URL must be a PostgreSQL connection URL",
    );

  const parsed = databaseUrlSchema.safeParse(process.env.DATABASE_URL);
  if (!parsed.success) {
    throw new Error(
      "Database migrations need a valid DATABASE_URL in the environment or backend/.env.",
    );
  }

  const pool = new Pool({
    connectionString: parsed.data,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });

  try {
    const result = await runMigrations(pool);
    for (const version of result.applied) {
      console.info(`Applied database migration ${version}.`);
    }
    console.info("Database migrations are up to date.");
  } finally {
    await pool.end();
  }
}

const isEntryPoint =
  typeof process.argv[1] === "string" &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isEntryPoint) {
  runCli().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown migration error.";
    console.error(`Database migration failed: ${message}`);
    process.exitCode = 1;
  });
}
