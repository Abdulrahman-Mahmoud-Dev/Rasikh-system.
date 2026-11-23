import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEFAULT_MIGRATION_DIR,
  runMigrations,
} from "../../src/db/migrate.js";
import { generateUuid } from "../../src/shared/utilities/crypto.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)(
  "Live PostgreSQL Migrations & Constitution Invariants",
  () => {
    let pool: Pool;

    beforeAll(async () => {
      pool = new Pool({ connectionString: testDatabaseUrl });
      await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    });

    afterAll(async () => {
      await pool.end();
    });

    it("applies all migrations once and skips cleanly on re-run", async () => {
      const firstRun = await runMigrations(pool, {
        migrationDir: DEFAULT_MIGRATION_DIR,
      });
      expect(firstRun.applied).toHaveLength(4);

      const secondRun = await runMigrations(pool, {
        migrationDir: DEFAULT_MIGRATION_DIR,
      });
      expect(secondRun.applied).toHaveLength(0);
      expect(secondRun.skipped).toHaveLength(4);
    });

    it("aborts if an already-applied migration checksum is modified", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "rasikh-mig-check-"));
      try {
        await writeFile(
          join(tempDir, "0001_core_identity_and_hierarchy.sql"),
          "-- tampered SQL\nSELECT 1;",
          "utf8",
        );

        await expect(
          runMigrations(pool, { migrationDir: tempDir }),
        ).rejects.toThrow(/modified/i);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it("enforces single active circle per student, max 2 guardians trigger, and append-only audit log", async () => {
      const assocId = generateUuid();
      const branchId = generateUuid();
      const premiseId = generateUuid();
      const circle1Id = generateUuid();
      const circle2Id = generateUuid();
      const studentPersonId = generateUuid();
      const studentId = generateUuid();

      await pool.query(
        `INSERT INTO public.associations (id, name) VALUES ($1, 'جمعية راسخ التجريبية')`,
        [assocId],
      );
      await pool.query(
        `INSERT INTO public.branches (id, association_id, city, district) VALUES ($1, $2, 'جدة', 'الوزيرية')`,
        [branchId, assocId],
      );
      await pool.query(
        `INSERT INTO public.quranic_premises (id, association_id, branch_id, premise_type, name)
         VALUES ($1, $2, $3, 'mosque', 'جامع الاختبار')`,
        [premiseId, assocId, branchId],
      );
      await pool.query(
        `INSERT INTO public.circles (id, association_id, quranic_premise_id, name, study_period, operational_status)
         VALUES ($1, $2, $3, 'حلقة ١', 'after_maghrib', 'active'),
                ($4, $2, $3, 'حلقة ٢', 'after_asr', 'active')`,
        [circle1Id, assocId, premiseId, circle2Id],
      );

      await pool.query(
        `INSERT INTO public.reserved_file_numbers (file_number) VALUES ('STD-100001')`,
      );
      await pool.query(
        `INSERT INTO public.persons (id, file_number, full_name, phone, email)
         VALUES ($1, 'STD-100001', 'طالب اختبار', '0501234567', 'std1@rasikh.example')`,
        [studentPersonId],
      );
      await pool.query(
        `INSERT INTO public.students (id, association_id, person_id)
         VALUES ($1, $2, $3)`,
        [studentId, assocId, studentPersonId],
      );

      // 1. Single active circle enrollment constraint
      await pool.query(
        `INSERT INTO public.student_circle_enrollments (id, association_id, student_id, circle_id)
         VALUES ($1, $2, $3, $4)`,
        [generateUuid(), assocId, studentId, circle1Id],
      );

      await expect(
        pool.query(
          `INSERT INTO public.student_circle_enrollments (id, association_id, student_id, circle_id)
           VALUES ($1, $2, $3, $4)`,
          [generateUuid(), assocId, studentId, circle2Id],
        ),
      ).rejects.toThrow();

      // 2. Max 2 active guardians trigger
      for (let i = 1; i <= 3; i++) {
        const gpId = generateUuid();
        const gmId = generateUuid();
        const fn = `GRD-10000${i}`;
        await pool.query(
          `INSERT INTO public.reserved_file_numbers (file_number) VALUES ($1)`,
          [fn],
        );
        await pool.query(
          `INSERT INTO public.persons (id, file_number, full_name, phone, email)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            gpId,
            fn,
            `ولي أمر ${i}`,
            `050000000${i}`,
            `guardian${i}@rasikh.example`,
          ],
        );
        await pool.query(
          `INSERT INTO public.association_memberships (id, association_id, person_id, status)
           VALUES ($1, $2, $3, 'active')`,
          [gmId, assocId, gpId],
        );

        const insertLink = pool.query(
          `INSERT INTO public.guardian_student_links (id, association_id, guardian_membership_id, student_id, relationship_label)
           VALUES ($1, $2, $3, $4, 'والد')`,
          [generateUuid(), assocId, gmId, studentId],
        );

        if (i <= 2) {
          await insertLink;
        } else {
          await expect(insertLink).rejects.toThrow(/more than 2 active guardian/i);
        }
      }

      // 3. Immutable audit_events trigger blocks UPDATE and DELETE
      const auditId = generateUuid();
      await pool.query(
        `INSERT INTO public.audit_events (id, association_id, event_type, entity_type)
         VALUES ($1, $2, 'test.created', 'student')`,
        [auditId, assocId],
      );

      await expect(
        pool.query(
          `UPDATE public.audit_events SET event_type = 'tampered' WHERE id = $1`,
          [auditId],
        ),
      ).rejects.toThrow(/append-only/i);

      await expect(
        pool.query(`DELETE FROM public.audit_events WHERE id = $1`, [auditId]),
      ).rejects.toThrow(/append-only/i);
    });
  },
);
