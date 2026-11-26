import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MIGRATION_DIR,
  loadMigrations,
  runMigrations,
} from "../../src/db/migrate.js";

function createMigrationMockPool(
  appliedRows: Array<{ version: string; checksum: string }>,
): Pool {
  const query = async <T extends QueryResultRow = QueryResultRow>(
    sql: string,
  ): Promise<QueryResult<T>> => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.startsWith("SELECT version, checksum FROM public.schema_migrations")) {
      return {
        rows: appliedRows as unknown as T[],
        command: "SELECT",
        rowCount: appliedRows.length,
        oid: 0,
        fields: [],
      };
    }
    return {
      rows: [],
      command: "SELECT",
      rowCount: 0,
      oid: 0,
      fields: [],
    };
  };

  const client = {
    query,
    release: () => {},
  } as unknown as PoolClient;

  return {
    connect: async () => client,
  } as unknown as Pool;
}

describe("SQL Migrations Structure & Constitution Compliance", () => {
  it("loads ordered SQL migrations with valid SHA-256 checksums", async () => {
    const migrations = await loadMigrations(DEFAULT_MIGRATION_DIR);

    expect(migrations.map((m) => m.filename)).toEqual([
      "0001_core_identity_and_hierarchy.sql",
      "0002_auth_memberships_and_authorization.sql",
      "0003_students_transfers_requests_and_audit.sql",
      "0004_education_plans_recitation_attendance_and_sync.sql",
      "0005_auth_google_password_and_workspaces.sql",
      "0006_circle_assistant_permissions.sql",
    ]);

    for (const migration of migrations) {
      expect(migration.checksum).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("enforces Constitution 1.5 constraints and excludes rejected concepts", async () => {
    const migrations = await loadMigrations(DEFAULT_MIGRATION_DIR);
    const allSql = migrations
      .map((m) => m.contents.replace(/--.*$/gm, ""))
      .join("\n");

    // Rejected concepts must never appear as columns or roles
    expect(allSql).not.toMatch(/\bmosque_manager\b/);
    expect(allSql).not.toMatch(/\bcircle_type\b/);

    // Required invariants
    expect(allSql).toContain("reserved_file_numbers");
    expect(allSql).toContain("student_one_active_circle_per_association_uidx");
    expect(allSql).toContain("enforce_max_two_active_guardians");
    expect(allSql).toContain("prevent_audit_event_mutation");
    expect(allSql).toContain(
      "CHECK (educational_status IN ('active', 'temporarily_suspended', 'expelled'))",
    );
  });

  it("detects both modified checksums and missing applied migrations in runMigrations", async () => {
    const migrations = await loadMigrations(DEFAULT_MIGRATION_DIR);
    const appliedRows = migrations.map((m) => ({
      version: m.version,
      checksum: m.checksum,
    }));
    const mockPool = createMigrationMockPool(appliedRows);

    // 1. Modified checksum when all versions exist
    const modifiedDir = await mkdtemp(join(tmpdir(), "rasikh-unit-mod-"));
    try {
      await cp(DEFAULT_MIGRATION_DIR, modifiedDir, { recursive: true });
      await writeFile(
        join(modifiedDir, "0001_core_identity_and_hierarchy.sql"),
        "-- modified\nSELECT 1;",
        "utf8",
      );
      await expect(
        runMigrations(mockPool, { migrationDir: modifiedDir }),
      ).rejects.toThrow(/modified/i);
    } finally {
      await rm(modifiedDir, { recursive: true, force: true });
    }

    // 2. Missing file when an applied version is absent
    const missingDir = await mkdtemp(join(tmpdir(), "rasikh-unit-miss-"));
    try {
      await writeFile(
        join(missingDir, "0001_core_identity_and_hierarchy.sql"),
        "-- only one file\nSELECT 1;",
        "utf8",
      );
      await expect(
        runMigrations(mockPool, { migrationDir: missingDir }),
      ).rejects.toThrow(/missing/i);
    } finally {
      await rm(missingDir, { recursive: true, force: true });
    }
  });
});
