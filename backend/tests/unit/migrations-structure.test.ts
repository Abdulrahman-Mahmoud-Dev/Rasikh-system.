import { describe, expect, it } from "vitest";

import {
  DEFAULT_MIGRATION_DIR,
  loadMigrations,
} from "../../src/db/migrate.js";

describe("SQL Migrations Structure & Constitution Compliance", () => {
  it("loads ordered SQL migrations with valid SHA-256 checksums", async () => {
    const migrations = await loadMigrations(DEFAULT_MIGRATION_DIR);

    expect(migrations.map((m) => m.filename)).toEqual([
      "0001_core_identity_and_hierarchy.sql",
      "0002_auth_memberships_and_authorization.sql",
      "0003_students_transfers_requests_and_audit.sql",
      "0004_education_plans_recitation_attendance_and_sync.sql",
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
});
