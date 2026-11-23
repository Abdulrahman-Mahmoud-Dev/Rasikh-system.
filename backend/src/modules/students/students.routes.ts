import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { withTransaction } from "../../db/transaction.js";
import { getRequiredAuth, requireAuth } from "../../plugins/authentication.js";
import {
  authorizeAssociationAction,
  extractScopeSets,
  isGuardianOnly,
} from "../../plugins/authorization.js";
import { STUDENT_STATUSES } from "../../shared/domain/constants.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../shared/errors/app-error.js";
import {
  normalizeArabicForSearch,
  normalizeSaudiPhone,
} from "../../shared/utilities/arabic.js";
import {
  generateFileNumber,
  generateUuid,
} from "../../shared/utilities/crypto.js";
import { recordAuditEvent } from "../audit/audit.service.js";

const associationParamsSchema = z.object({
  associationId: z.string().uuid(),
});

const studentParamsSchema = z.object({
  associationId: z.string().uuid(),
  studentId: z.string().uuid(),
});

const createStudentSchema = z.object({
  circleId: z.string().uuid(),
  personId: z.string().uuid().optional(),
  fullName: z.string().trim().min(3).max(200).optional(),
  phone: z.string().trim().min(9).max(20).optional(),
  email: z.string().trim().email().max(255).optional(),
  previousMemorizedJuz: z.coerce.number().min(0).max(30).default(0),
});

const listStudentsQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  circleId: z.string().uuid().optional(),
  status: z.enum(STUDENT_STATUSES).optional(),
});

const updateStudentStatusSchema = z.object({
  educationalStatus: z.enum(STUDENT_STATUSES),
  reason: z.string().trim().min(2).max(500).optional(),
});

const createTransferSchema = z.object({
  toCircleId: z.string().uuid(),
  reason: z.string().trim().min(2).max(500),
});

interface CircleScopeRow {
  circle_id: string;
  quranic_premise_id: string;
  branch_id: string;
  operational_status: string;
}

interface StudentLookupRow {
  student_id: string;
  person_id: string;
  educational_status: string;
  circle_id: string | null;
  quranic_premise_id: string | null;
  branch_id: string | null;
}

interface StudentListRow {
  student_id: string;
  person_id: string;
  file_number: string;
  full_name: string;
  educational_status: string;
  previous_memorized_juz: string | number;
  circle_id: string | null;
  circle_name: string | null;
  premise_name: string | null;
}

function isPgUniqueViolation(error: unknown, constraintName?: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const pgErr = error as { code?: string; constraint?: string };
  if (pgErr.code !== "23505") return false;
  return constraintName ? pgErr.constraint === constraintName : true;
}

const studentsRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/associations/:associationId/students",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = getRequiredAuth(request);
      const { associationId } = associationParamsSchema.parse(request.params);
      const body = createStudentSchema.parse(request.body);

      if (!body.personId && (!body.fullName || !body.phone || !body.email)) {
        throw new BadRequestError(
          "يجب تمرير معرف الشخص أو إدخال الاسم الكامل والجوال والبريد الإلكتروني.",
          "STUDENT_IDENTITY_REQUIRED",
        );
      }

      const normalizedPhone = body.phone
        ? normalizeSaudiPhone(body.phone)
        : null;
      if (body.phone && !normalizedPhone) {
        throw new BadRequestError(
          "رقم الجوال يجب أن يبدأ بـ 05 ويتكون من 10 أرقام.",
          "INVALID_SAUDI_PHONE",
        );
      }

      const created = await withTransaction(app.db, async (client) => {
        const circleRes = await client.query<CircleScopeRow>(
          `SELECT
             c.id AS circle_id,
             c.quranic_premise_id,
             qp.branch_id,
             c.operational_status
           FROM public.circles c
           INNER JOIN public.quranic_premises qp
             ON qp.id = c.quranic_premise_id AND qp.association_id = c.association_id
           WHERE c.id = $1 AND c.association_id = $2
           LIMIT 1`,
          [body.circleId, associationId],
        );

        const circle = circleRes.rows[0];
        if (!circle) {
          throw new NotFoundError(
            "الحلقة المحددة غير موجودة في هذه الجمعية.",
            "CIRCLE_NOT_FOUND",
          );
        }

        if (circle.operational_status === "closed") {
          throw new BadRequestError(
            "لا يمكن تسجيل طالب في حلقة مغلقة.",
            "CIRCLE_CLOSED",
          );
        }

        const authz = await authorizeAssociationAction(
          request,
          client,
          associationId,
          "students:create",
          {
            targetScope: {
              branchId: circle.branch_id,
              quranicPremiseId: circle.quranic_premise_id,
              circleId: circle.circle_id,
            },
          },
        );

        let personId = body.personId;
        if (!personId && body.fullName && normalizedPhone && body.email) {
          let reservedNumber: string | null = null;
          for (let attempt = 0; attempt < 5; attempt++) {
            const candidate = generateFileNumber(body.fullName);
            const inserted = await client.query(
              `INSERT INTO public.reserved_file_numbers (file_number)
               VALUES ($1)
               ON CONFLICT (file_number) DO NOTHING
               RETURNING file_number`,
              [candidate],
            );
            if (inserted.rows[0]) {
              reservedNumber = candidate;
              break;
            }
          }

          if (!reservedNumber) {
            throw new ConflictError(
              "تعذر توليد رقم ملف فريد للطالب.",
              "FILE_NUMBER_GENERATION_FAILED",
            );
          }

          personId = generateUuid();
          await client.query(
            `INSERT INTO public.persons (id, file_number, full_name, phone, email)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              personId,
              reservedNumber,
              body.fullName,
              normalizedPhone,
              body.email.trim().toLowerCase(),
            ],
          );
        }

        if (!personId) {
          throw new BadRequestError("تعذر تحديد ملف الشخص للطالب.");
        }

        const existingStudent = await client.query<{ id: string }>(
          `SELECT id
           FROM public.students
           WHERE association_id = $1 AND person_id = $2
           LIMIT 1`,
          [associationId, personId],
        );

        let studentId = existingStudent.rows[0]?.id;
        if (!studentId) {
          studentId = generateUuid();
          await client.query(
            `INSERT INTO public.students (
               id,
               association_id,
               person_id,
               educational_status,
               previous_memorized_juz
             )
             VALUES ($1, $2, $3, 'active', $4)`,
            [studentId, associationId, personId, body.previousMemorizedJuz],
          );
        }

        const enrollmentId = generateUuid();
        try {
          await client.query(
            `INSERT INTO public.student_circle_enrollments (
               id,
               association_id,
               student_id,
               circle_id,
               recorded_by_membership_id
             )
             VALUES ($1, $2, $3, $4, $5)`,
            [
              enrollmentId,
              associationId,
              studentId,
              circle.circle_id,
              authz.membershipId,
            ],
          );
        } catch (error) {
          if (
            isPgUniqueViolation(
              error,
              "student_one_active_circle_per_association_uidx",
            )
          ) {
            throw new ConflictError(
              "الطالب مسجل بالفعل في حلقة نشطة داخل هذه الجمعية. يرجى استخدام مسار طلب النقل.",
              "STUDENT_ALREADY_ENROLLED",
            );
          }
          throw error;
        }

        await recordAuditEvent(client, {
          associationId,
          actorPersonId: auth.personId,
          actorMembershipId: authz.membershipId,
          eventType: "student.enrolled",
          entityType: "student",
          entityId: studentId,
          newData: {
            circleId: circle.circle_id,
            enrollmentId,
          },
        });

        return { studentId, personId, enrollmentId };
      });

      return reply.status(201).send({
        student: {
          id: created.studentId,
          personId: created.personId,
          circleId: body.circleId,
          enrollmentId: created.enrollmentId,
          educationalStatus: "active",
        },
      });
    },
  );

  app.get(
    "/associations/:associationId/students",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { associationId } = associationParamsSchema.parse(request.params);
      const query = listStudentsQuerySchema.parse(request.query);

      const authz = await authorizeAssociationAction(
        request,
        app.db,
        associationId,
        "students:read",
        { allowScopedListEntry: true },
      );

      const guardianOnly = isGuardianOnly(authz.assignments);
      const scopes = extractScopeSets(authz.assignments, "students:read");

      const conditions = ["s.association_id = $1"];
      const params: unknown[] = [associationId];

      if (query.status) {
        params.push(query.status);
        conditions.push(`s.educational_status = $${params.length}`);
      }

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
          return reply.status(200).send({ students: [] });
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

      const result = await app.db.query<StudentListRow>(
        `SELECT
           s.id AS student_id,
           s.person_id,
           p.file_number,
           p.full_name,
           s.educational_status,
           s.previous_memorized_juz,
           c.id AS circle_id,
           c.name AS circle_name,
           qp.name AS premise_name
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
         WHERE ${conditions.join(" AND ")}
         ORDER BY p.full_name ASC`,
        params,
      );

      let students = result.rows;
      if (query.q) {
        const needle = normalizeArabicForSearch(query.q);
        students = students.filter((row) => {
          const nameMatch = normalizeArabicForSearch(row.full_name).includes(
            needle,
          );
          const fileMatch = normalizeArabicForSearch(row.file_number).includes(
            needle,
          );
          return nameMatch || fileMatch;
        });
      }

      return reply.status(200).send({
        students: students.map((row) => ({
          id: row.student_id,
          personId: row.person_id,
          fileNumber: row.file_number,
          fullName: row.full_name,
          educationalStatus: row.educational_status,
          previousMemorizedJuz: Number(row.previous_memorized_juz),
          circleId: row.circle_id,
          circleName: row.circle_name,
          premiseName: row.premise_name,
        })),
      });
    },
  );

  app.patch(
    "/associations/:associationId/students/:studentId/status",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = getRequiredAuth(request);
      const { associationId, studentId } = studentParamsSchema.parse(
        request.params,
      );
      const body = updateStudentStatusSchema.parse(request.body);

      const updated = await withTransaction(app.db, async (client) => {
        const studentRes = await client.query<StudentLookupRow>(
          `SELECT
             s.id AS student_id,
             s.person_id,
             s.educational_status,
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
          throw new NotFoundError("ملف الطالب غير موجود.", "STUDENT_NOT_FOUND");
        }

        const authz = await authorizeAssociationAction(
          request,
          client,
          associationId,
          "students:update",
          {
            targetScope: {
              branchId: student.branch_id,
              quranicPremiseId: student.quranic_premise_id,
              circleId: student.circle_id,
            },
          },
        );

        await client.query(
          `UPDATE public.students
           SET educational_status = $2, updated_at = now()
           WHERE id = $1`,
          [studentId, body.educationalStatus],
        );

        await recordAuditEvent(client, {
          associationId,
          actorPersonId: auth.personId,
          actorMembershipId: authz.membershipId,
          eventType: "student.status_changed",
          entityType: "student",
          entityId: studentId,
          previousData: { educationalStatus: student.educational_status },
          newData: { educationalStatus: body.educationalStatus },
          reason: body.reason ?? null,
        });

        return {
          previousStatus: student.educational_status,
          educationalStatus: body.educationalStatus,
        };
      });

      return reply.status(200).send({
        studentId,
        ...updated,
      });
    },
  );

  // Creates a tracked transfer request without overwriting enrollment history.
  app.post(
    "/associations/:associationId/students/:studentId/transfers",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = getRequiredAuth(request);
      const { associationId, studentId } = studentParamsSchema.parse(
        request.params,
      );
      const body = createTransferSchema.parse(request.body);

      const transfer = await withTransaction(app.db, async (client) => {
        const studentRes = await client.query<StudentLookupRow>(
          `SELECT
             s.id AS student_id,
             s.person_id,
             s.educational_status,
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
        if (!student || !student.circle_id) {
          throw new NotFoundError(
            "الطالب غير مسجل حاليًا في حلقة نشطة.",
            "ACTIVE_ENROLLMENT_NOT_FOUND",
          );
        }

        if (student.circle_id === body.toCircleId) {
          throw new BadRequestError(
            "لا يمكن نقل الطالب إلى نفس الحلقة المسجل بها حاليًا.",
            "SAME_CIRCLE_TRANSFER",
          );
        }

        const targetCircleRes = await client.query<CircleScopeRow>(
          `SELECT
             c.id AS circle_id,
             c.quranic_premise_id,
             qp.branch_id,
             c.operational_status
           FROM public.circles c
           INNER JOIN public.quranic_premises qp
             ON qp.id = c.quranic_premise_id AND qp.association_id = c.association_id
           WHERE c.id = $1 AND c.association_id = $2
           LIMIT 1`,
          [body.toCircleId, associationId],
        );

        const targetCircle = targetCircleRes.rows[0];
        if (!targetCircle || targetCircle.operational_status !== "active") {
          throw new BadRequestError(
            "الحلقة المستقبلة غير متاحة أو غير مفعلة حاليًا.",
            "TARGET_CIRCLE_UNAVAILABLE",
          );
        }

        const authz = await authorizeAssociationAction(
          request,
          client,
          associationId,
          "students:transfer",
          {
            targetScope: {
              branchId: student.branch_id,
              quranicPremiseId: student.quranic_premise_id,
              circleId: student.circle_id,
            },
          },
        );

        const transferId = generateUuid();
        await client.query(
          `INSERT INTO public.student_transfers (
             id,
             association_id,
             student_id,
             from_circle_id,
             to_circle_id,
             requested_by_membership_id,
             status,
             reason
           )
           VALUES ($1, $2, $3, $4, $5, $6, 'pending_supervisor', $7)`,
          [
            transferId,
            associationId,
            studentId,
            student.circle_id,
            targetCircle.circle_id,
            authz.membershipId,
            body.reason,
          ],
        );

        await recordAuditEvent(client, {
          associationId,
          actorPersonId: auth.personId,
          actorMembershipId: authz.membershipId,
          eventType: "student.transfer_requested",
          entityType: "student_transfer",
          entityId: transferId,
          newData: {
            studentId,
            fromCircleId: student.circle_id,
            toCircleId: targetCircle.circle_id,
          },
          reason: body.reason,
        });

        return {
          transferId,
          fromCircleId: student.circle_id,
          toCircleId: targetCircle.circle_id,
        };
      });

      return reply.status(201).send({
        transfer: {
          id: transfer.transferId,
          studentId,
          fromCircleId: transfer.fromCircleId,
          toCircleId: transfer.toCircleId,
          status: "pending_supervisor",
        },
      });
    },
  );
};

export default studentsRoutes;
