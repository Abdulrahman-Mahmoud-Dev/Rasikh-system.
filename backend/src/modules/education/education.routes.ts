import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { withTransaction, type Queryable } from "../../db/transaction.js";
import { getRequiredAuth, requireAuth } from "../../plugins/authentication.js";
import {
  authorizeAssociationAction,
  extractScopeSets,
  isGuardianOnly,
} from "../../plugins/authorization.js";
import {
  ATTENDANCE_STATUSES,
  DAILY_RATINGS,
  QUALITY_MULTIPLIERS,
  RECITATION_TRACKS,
  type AttendanceStatus,
  type DailyRating,
  type RecitationTrack,
} from "../../shared/domain/constants.js";
import {
  BadRequestError,
  NotFoundError,
} from "../../shared/errors/app-error.js";
import { generateUuid } from "../../shared/utilities/crypto.js";
import { evaluateStudentMonthlyProgress } from "../../shared/utilities/teacher-guide-evaluator.js";
import { recordAuditEvent } from "../audit/audit.service.js";

const associationParamsSchema = z.object({
  associationId: z.string().uuid(),
});

const studentPlanParamsSchema = z.object({
  associationId: z.string().uuid(),
  studentId: z.string().uuid(),
});

const createPlanSchema = z.object({
  title: z.string().trim().min(2).max(200),
  targetMemorizationPages: z.coerce.number().min(0).max(1000).default(20),
  targetReviewPages: z.coerce.number().min(0).max(5000).default(200),
  targetStudyDays: z.coerce.number().int().min(1).max(31).default(20),
  hijriStartDate: z.string().trim().min(4).max(40),
  hijriEndDate: z.string().trim().min(4).max(40),
  weeklyDistribution: z.record(z.unknown()).optional(),
});

const attendanceEntrySchema = z.object({
  studentId: z.string().uuid(),
  circleId: z.string().uuid(),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hijriPeriodKey: z.string().trim().min(3).max(60),
  status: z.enum(ATTENDANCE_STATUSES),
  isLateEntry: z.boolean().default(false),
});

const recordAttendanceSchema = z.object({
  entries: z.array(attendanceEntrySchema).min(1).max(200),
  clientOperationId: z.string().uuid().optional(),
  deviceInstanceId: z.string().uuid().optional(),
  payloadSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});

const recordRecitationSchema = z.object({
  studentId: z.string().uuid(),
  circleId: z.string().uuid(),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hijriPeriodKey: z.string().trim().min(3).max(60),
  track: z.enum(RECITATION_TRACKS),
  fromSurah: z.coerce.number().int().min(1).max(114),
  fromAyah: z.coerce.number().int().min(1).max(300),
  toSurah: z.coerce.number().int().min(1).max(114),
  toAyah: z.coerce.number().int().min(1).max(300),
  pagesCount: z.coerce.number().min(0).max(604),
  dailyRating: z.enum(DAILY_RATINGS),
  scoreOutOf10: z.coerce.number().min(0).max(10),
  tajweedErrors: z.coerce.number().int().min(0).default(0),
  readingErrors: z.coerce.number().int().min(0).default(0),
  teacherNote: z.string().trim().max(500).optional(),
  isLateEntry: z.boolean().default(false),
  clientOperationId: z.string().uuid().optional(),
  deviceInstanceId: z.string().uuid().optional(),
  payloadSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});

const monthlyReportQuerySchema = z.object({
  hijriPeriodKey: z.string().trim().min(3).max(60),
  circleId: z.string().uuid().optional(),
  studyDays: z.coerce.number().int().min(1).max(31).default(20),
});

interface CircleScopeRow {
  circle_id: string;
  quranic_premise_id: string;
  branch_id: string;
}

interface ExistingReceiptRow {
  outcome: "accepted" | "conflict" | "rejected";
  result_code: string | null;
}

interface EvalSettingsRow {
  id: string;
  memorization_weight: string | number;
  review_weight: string | number;
  attendance_weight: string | number;
  excellent_multiplier: string | number;
  very_good_multiplier: string | number;
  good_multiplier: string | number;
  acceptable_multiplier: string | number;
}

interface ReportStudentRow {
  student_id: string;
  full_name: string;
  file_number: string;
  circle_name: string | null;
  target_memorization_pages: string | number | null;
  target_review_pages: string | number | null;
  target_study_days: number | null;
}

interface AttendanceReportRow {
  student_id: string;
  status: AttendanceStatus;
}

interface RecitationReportRow {
  student_id: string;
  track: RecitationTrack;
  pages_count: string | number;
  daily_rating: DailyRating;
}

async function resolveCircleScope(
  db: Queryable,
  associationId: string,
  circleId: string,
): Promise<CircleScopeRow> {
  const res = await db.query<CircleScopeRow>(
    `SELECT
       c.id AS circle_id,
       c.quranic_premise_id,
       qp.branch_id
     FROM public.circles c
     INNER JOIN public.quranic_premises qp
       ON qp.id = c.quranic_premise_id AND qp.association_id = c.association_id
     WHERE c.id = $1 AND c.association_id = $2
     LIMIT 1`,
    [circleId, associationId],
  );

  const circle = res.rows[0];
  if (!circle) {
    throw new NotFoundError(
      "الحلقة المحددة غير موجودة في هذه الجمعية.",
      "CIRCLE_NOT_FOUND",
    );
  }
  return circle;
}

const educationRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/associations/:associationId/students/:studentId/plans",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = getRequiredAuth(request);
      const { associationId, studentId } = studentPlanParamsSchema.parse(
        request.params,
      );
      const body = createPlanSchema.parse(request.body);

      const planId = generateUuid();

      await withTransaction(app.db, async (client) => {
        const studentRes = await client.query<{
          circle_id: string | null;
          quranic_premise_id: string | null;
          branch_id: string | null;
        }>(
          `SELECT
             e.circle_id,
             c.quranic_premise_id,
             qp.branch_id
           FROM public.students s
           LEFT JOIN public.student_circle_enrollments e
             ON e.student_id = s.id
             AND e.association_id = s.association_id
             AND e.ended_at IS NULL
           LEFT JOIN public.circles c
             ON c.id = e.circle_id AND c.association_id = s.association_id
           LEFT JOIN public.quranic_premises qp
             ON qp.id = c.quranic_premise_id AND qp.association_id = s.association_id
           WHERE s.id = $1 AND s.association_id = $2
           LIMIT 1`,
          [studentId, associationId],
        );

        const student = studentRes.rows[0];
        if (!student) {
          throw new NotFoundError("الطالب غير موجود.", "STUDENT_NOT_FOUND");
        }

        const authz = await authorizeAssociationAction(
          request,
          client,
          associationId,
          "plans:manage",
          {
            targetScope: {
              branchId: student.branch_id,
              quranicPremiseId: student.quranic_premise_id,
              circleId: student.circle_id,
            },
          },
        );

        await client.query(
          `INSERT INTO public.education_plans (
             id,
             association_id,
             student_id,
             created_by_membership_id,
             title,
             target_memorization_pages,
             target_review_pages,
             target_study_days,
             hijri_start_date,
             hijri_end_date,
             weekly_distribution,
             status,
             activated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', now())`,
          [
            planId,
            associationId,
            studentId,
            authz.membershipId,
            body.title,
            body.targetMemorizationPages,
            body.targetReviewPages,
            body.targetStudyDays,
            body.hijriStartDate,
            body.hijriEndDate,
            body.weeklyDistribution
              ? JSON.stringify(body.weeklyDistribution)
              : null,
          ],
        );

        await recordAuditEvent(client, {
          associationId,
          actorPersonId: auth.personId,
          actorMembershipId: authz.membershipId,
          eventType: "education_plan.created",
          entityType: "education_plan",
          entityId: planId,
          newData: {
            studentId,
            title: body.title,
            targetMemorizationPages: body.targetMemorizationPages,
            targetReviewPages: body.targetReviewPages,
          },
        });
      });

      return reply.status(201).send({
        plan: {
          id: planId,
          studentId,
          title: body.title,
          status: "active",
        },
      });
    },
  );

  app.post(
    "/associations/:associationId/attendance",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = getRequiredAuth(request);
      const { associationId } = associationParamsSchema.parse(request.params);
      const body = recordAttendanceSchema.parse(request.body);

      if (
        body.clientOperationId &&
        (!body.deviceInstanceId || !body.payloadSha256)
      ) {
        throw new BadRequestError(
          "إيصال المزامنة يتطلب معرف الجهاز وبصمة البيانات (SHA-256).",
          "INCOMPLETE_SYNC_RECEIPT",
        );
      }

      const result = await withTransaction(app.db, async (client) => {
        const firstCircleId = body.entries[0]?.circleId;
        if (!firstCircleId) {
          throw new BadRequestError("قائمة الحضور فارغة.");
        }

        const circleScopeCache = new Map<string, CircleScopeRow>();
        let actorMembershipId: string | null = null;

        for (const entry of body.entries) {
          let circleScope = circleScopeCache.get(entry.circleId);
          if (!circleScope) {
            circleScope = await resolveCircleScope(
              client,
              associationId,
              entry.circleId,
            );
            circleScopeCache.set(entry.circleId, circleScope);
          }

          const authz = await authorizeAssociationAction(
            request,
            client,
            associationId,
            "attendance:record",
            {
              targetScope: {
                branchId: circleScope.branch_id,
                quranicPremiseId: circleScope.quranic_premise_id,
                circleId: circleScope.circle_id,
              },
            },
          );
          actorMembershipId = authz.membershipId;
        }

        if (body.clientOperationId && actorMembershipId) {
          const existingReceipt = await client.query<ExistingReceiptRow>(
            `SELECT outcome, result_code
             FROM public.sync_operation_receipts
             WHERE association_id = $1 AND client_operation_id = $2
             LIMIT 1`,
            [associationId, body.clientOperationId],
          );

          const prev = existingReceipt.rows[0];
          if (prev) {
            return {
              deduplicated: true,
              recordedCount: 0,
              outcome: prev.outcome,
            };
          }
        }

        for (const entry of body.entries) {
          await client.query(
            `INSERT INTO public.daily_attendance_records (
               id,
               association_id,
               student_id,
               circle_id,
               session_date,
               hijri_period_key,
               status,
               is_late_entry,
               recorded_by_membership_id
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (association_id, student_id, session_date)
             DO UPDATE SET
               status = EXCLUDED.status,
               is_late_entry = EXCLUDED.is_late_entry,
               recorded_by_membership_id = EXCLUDED.recorded_by_membership_id,
               updated_at = now()`,
            [
              generateUuid(),
              associationId,
              entry.studentId,
              entry.circleId,
              entry.sessionDate,
              entry.hijriPeriodKey,
              entry.status,
              entry.isLateEntry,
              actorMembershipId,
            ],
          );
        }

        if (
          body.clientOperationId &&
          body.deviceInstanceId &&
          body.payloadSha256 &&
          actorMembershipId
        ) {
          await client.query(
            `INSERT INTO public.sync_operation_receipts (
               id,
               association_id,
               membership_id,
               account_id,
               person_id,
               device_instance_id,
               client_operation_id,
               operation_type,
               payload_sha256,
               outcome
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'attendance.record', $8, 'accepted')`,
            [
              generateUuid(),
              associationId,
              actorMembershipId,
              auth.accountId,
              auth.personId,
              body.deviceInstanceId,
              body.clientOperationId,
              body.payloadSha256,
            ],
          );
        }

        return {
          deduplicated: false,
          recordedCount: body.entries.length,
          outcome: "accepted" as const,
        };
      });

      return reply.status(201).send(result);
    },
  );

  app.post(
    "/associations/:associationId/recitations",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = getRequiredAuth(request);
      const { associationId } = associationParamsSchema.parse(request.params);
      const body = recordRecitationSchema.parse(request.body);

      if (
        body.clientOperationId &&
        (!body.deviceInstanceId || !body.payloadSha256)
      ) {
        throw new BadRequestError(
          "إيصال المزامنة يتطلب معرف الجهاز وبصمة البيانات (SHA-256).",
          "INCOMPLETE_SYNC_RECEIPT",
        );
      }

      const qualityMultiplier = QUALITY_MULTIPLIERS[body.dailyRating];
      const recitationId = generateUuid();

      const result = await withTransaction(app.db, async (client) => {
        const circleScope = await resolveCircleScope(
          client,
          associationId,
          body.circleId,
        );

        const authz = await authorizeAssociationAction(
          request,
          client,
          associationId,
          "recitations:record",
          {
            targetScope: {
              branchId: circleScope.branch_id,
              quranicPremiseId: circleScope.quranic_premise_id,
              circleId: circleScope.circle_id,
            },
          },
        );

        if (body.clientOperationId) {
          const existingReceipt = await client.query<ExistingReceiptRow>(
            `SELECT outcome, result_code
             FROM public.sync_operation_receipts
             WHERE association_id = $1 AND client_operation_id = $2
             LIMIT 1`,
            [associationId, body.clientOperationId],
          );

          const prev = existingReceipt.rows[0];
          if (prev) {
            return {
              deduplicated: true,
              recitationId: null,
              outcome: prev.outcome,
            };
          }
        }

        await client.query(
          `INSERT INTO public.daily_recitation_records (
             id,
             association_id,
             student_id,
             circle_id,
             session_date,
             hijri_period_key,
             track,
             from_surah,
             from_ayah,
             to_surah,
             to_ayah,
             pages_count,
             daily_rating,
             quality_multiplier,
             score_out_of_10,
             tajweed_errors,
             reading_errors,
             teacher_note,
             is_late_entry,
             recorded_by_membership_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
          [
            recitationId,
            associationId,
            body.studentId,
            body.circleId,
            body.sessionDate,
            body.hijriPeriodKey,
            body.track,
            body.fromSurah,
            body.fromAyah,
            body.toSurah,
            body.toAyah,
            body.pagesCount,
            body.dailyRating,
            qualityMultiplier,
            body.scoreOutOf10,
            body.tajweedErrors,
            body.readingErrors,
            body.teacherNote ?? null,
            body.isLateEntry,
            authz.membershipId,
          ],
        );

        if (
          body.clientOperationId &&
          body.deviceInstanceId &&
          body.payloadSha256
        ) {
          await client.query(
            `INSERT INTO public.sync_operation_receipts (
               id,
               association_id,
               membership_id,
               account_id,
               person_id,
               device_instance_id,
               client_operation_id,
               operation_type,
               payload_sha256,
               outcome
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'recitation.record', $8, 'accepted')`,
            [
              generateUuid(),
              associationId,
              authz.membershipId,
              auth.accountId,
              auth.personId,
              body.deviceInstanceId,
              body.clientOperationId,
              body.payloadSha256,
            ],
          );
        }

        return {
          deduplicated: false,
          recitationId,
          outcome: "accepted" as const,
        };
      });

      return reply.status(201).send({
        ...result,
        qualityMultiplier,
      });
    },
  );

  app.get(
    "/associations/:associationId/reports/monthly",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { associationId } = associationParamsSchema.parse(request.params);
      const query = monthlyReportQuerySchema.parse(request.query);

      const authz = await authorizeAssociationAction(
        request,
        app.db,
        associationId,
        "reports:read",
        { allowScopedListEntry: true },
      );

      const settingsRes = await app.db.query<EvalSettingsRow>(
        `SELECT
           id,
           memorization_weight,
           review_weight,
           attendance_weight,
           excellent_multiplier,
           very_good_multiplier,
           good_multiplier,
           acceptable_multiplier
         FROM public.association_evaluation_settings
         WHERE association_id = $1 AND is_active = true
         LIMIT 1`,
        [associationId],
      );

      const settings = settingsRes.rows[0];
      const weights = settings
        ? {
            memorizationWeight: Number(settings.memorization_weight),
            reviewWeight: Number(settings.review_weight),
            attendanceWeight: Number(settings.attendance_weight),
          }
        : { memorizationWeight: 40, reviewWeight: 30, attendanceWeight: 30 };

      const multipliers = settings
        ? {
            excellent: Number(settings.excellent_multiplier),
            very_good: Number(settings.very_good_multiplier),
            good: Number(settings.good_multiplier),
            acceptable: Number(settings.acceptable_multiplier),
            retry: Number(settings.acceptable_multiplier),
            not_recited: 0,
          }
        : undefined;

      const guardianOnly = isGuardianOnly(authz.assignments);
      const scopes = extractScopeSets(authz.assignments, "reports:read");

      const conditions = ["s.association_id = $1"];
      const params: unknown[] = [associationId];

      if (query.circleId) {
        params.push(query.circleId);
        conditions.push(`e.circle_id = $${params.length}`);
      }

      if (guardianOnly) {
        params.push(authz.membershipId);
        conditions.push(
          `EXISTS (
             SELECT 1
             FROM public.guardian_student_links gsl
             WHERE gsl.association_id = s.association_id
               AND gsl.student_id = s.id
               AND gsl.guardian_membership_id = $${params.length}
               AND gsl.valid_until IS NULL
           )`,
        );
      } else if (!scopes.hasAssociationScope) {
        if (
          scopes.branchIds.length === 0 &&
          scopes.premiseIds.length === 0 &&
          scopes.circleIds.length === 0
        ) {
          return reply.status(200).send({
            hijriPeriodKey: query.hijriPeriodKey,
            weights,
            students: [],
          });
        }

        params.push(scopes.branchIds, scopes.premiseIds, scopes.circleIds);
        const branchParam = `$${params.length - 2}`;
        const premiseParam = `$${params.length - 1}`;
        const circleParam = `$${params.length}`;

        conditions.push(
          `(
             qp.branch_id = ANY(${branchParam}::uuid[])
             OR qp.id = ANY(${premiseParam}::uuid[])
             OR c.id = ANY(${circleParam}::uuid[])
           )`,
        );
      }

      const studentsRes = await app.db.query<ReportStudentRow>(
        `SELECT
           s.id AS student_id,
           p.full_name,
           p.file_number,
           c.name AS circle_name,
           ep.target_memorization_pages,
           ep.target_review_pages,
           ep.target_study_days
         FROM public.students s
         INNER JOIN public.persons p
           ON p.id = s.person_id
         LEFT JOIN public.student_circle_enrollments e
           ON e.student_id = s.id
           AND e.association_id = s.association_id
           AND e.ended_at IS NULL
         LEFT JOIN public.circles c
           ON c.id = e.circle_id AND c.association_id = s.association_id
         LEFT JOIN public.quranic_premises qp
           ON qp.id = c.quranic_premise_id AND qp.association_id = s.association_id
         LEFT JOIN public.education_plans ep
           ON ep.student_id = s.id
           AND ep.association_id = s.association_id
           AND ep.status = 'active'
         WHERE ${conditions.join(" AND ")}
         ORDER BY p.full_name ASC`,
        params,
      );

      if (studentsRes.rows.length === 0) {
        return reply.status(200).send({
          hijriPeriodKey: query.hijriPeriodKey,
          weights,
          students: [],
        });
      }

      const studentIds = studentsRes.rows.map((r) => r.student_id);

      const attendanceRes = await app.db.query<AttendanceReportRow>(
        `SELECT student_id, status
         FROM public.daily_attendance_records
         WHERE association_id = $1
           AND hijri_period_key = $2
           AND student_id = ANY($3::uuid[])`,
        [associationId, query.hijriPeriodKey, studentIds],
      );

      const recitationRes = await app.db.query<RecitationReportRow>(
        `SELECT student_id, track, pages_count, daily_rating
         FROM public.daily_recitation_records
         WHERE association_id = $1
           AND hijri_period_key = $2
           AND student_id = ANY($3::uuid[])`,
        [associationId, query.hijriPeriodKey, studentIds],
      );

      const attendanceByStudent = new Map<string, AttendanceReportRow[]>();
      for (const row of attendanceRes.rows) {
        const list = attendanceByStudent.get(row.student_id) ?? [];
        list.push(row);
        attendanceByStudent.set(row.student_id, list);
      }

      const recitationByStudent = new Map<string, RecitationReportRow[]>();
      for (const row of recitationRes.rows) {
        const list = recitationByStudent.get(row.student_id) ?? [];
        list.push(row);
        recitationByStudent.set(row.student_id, list);
      }

      const reportItems = studentsRes.rows.map((student) => {
        const attEntries = (attendanceByStudent.get(student.student_id) ?? []).map(
          (r) => ({ status: r.status }),
        );
        const recEntries = (recitationByStudent.get(student.student_id) ?? []).map(
          (r) => ({
            track: r.track,
            pagesCount: Number(r.pages_count),
            rating: r.daily_rating,
          }),
        );

        const evaluation = evaluateStudentMonthlyProgress({
          weights,
          multipliers,
          targetMemorizationPages: Number(
            student.target_memorization_pages ?? 20,
          ),
          targetReviewPages: Number(student.target_review_pages ?? 200),
          studyDays: student.target_study_days ?? query.studyDays,
          attendanceEntries: attEntries,
          recitationEntries: recEntries,
        });

        return {
          studentId: student.student_id,
          fullName: student.full_name,
          fileNumber: student.file_number,
          circleName: student.circle_name,
          ...evaluation,
        };
      });

      return reply.status(200).send({
        hijriPeriodKey: query.hijriPeriodKey,
        weights,
        students: reportItems,
      });
    },
  );
};

export default educationRoutes;
