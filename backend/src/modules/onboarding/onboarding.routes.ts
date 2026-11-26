import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { env } from "../../config/env.js";
import { withTransaction } from "../../db/transaction.js";
import { getRequiredAuth, requireAuth } from "../../plugins/authentication.js";
import { ROLE_DEFAULT_PERMISSIONS } from "../../shared/domain/constants.js";
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
} from "../../shared/errors/app-error.js";
import {
  generateFileNumber,
  generateUuid,
} from "../../shared/utilities/crypto.js";
import { recordAuditEvent } from "../audit/audit.service.js";

const associationRegistrationSchema = z.object({
  name: z.string().trim().min(3).max(200),
  licenseNumber: z.string().trim().min(2).max(100),
  licensingAuthority: z.string().trim().min(2).max(200),
});

const independentWorkspaceSchema = z.object({
  workspaceKind: z.enum(["independent_mosque", "independent_quranic_center"]),
  name: z.string().trim().min(2).max(200),
  city: z.string().trim().min(2).max(120),
  district: z.string().trim().min(2).max(120),
  administrativeRegion: z.string().trim().min(2).max(120).optional(),
  circleName: z.string().trim().min(2).max(200),
  studyPeriod: z.enum([
    "after_fajr",
    "after_dhuhr",
    "after_asr",
    "after_maghrib",
    "after_isha",
  ]),
});

const reviewRegistrationSchema = z.object({
  decision: z.enum(["verified", "rejected"]),
  decisionReason: z.string().trim().min(2).max(500).optional(),
  confirmedAssociationName: z.string().trim().min(3).max(200).optional(),
  verificationReference: z.string().trim().min(2).max(200).optional(),
});

interface RegistrationStatusRow {
  id: string;
  association_id: string;
  association_name: string;
  license_number: string;
  licensing_authority: string;
  status: string;
  decision_reason: string | null;
  created_at: Date | string;
}

async function createEvaluationSettings(
  client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  associationId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO public.association_evaluation_settings (id, association_id)
     VALUES ($1, $2)`,
    [generateUuid(), associationId],
  );
}

async function createOwnerMembership(
  client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  associationId: string,
  personId: string,
  roleCode: "association_manager" | "supervisor",
  scope: {
    scopeType: "association" | "quranic_premise";
    quranicPremiseId?: string;
  },
): Promise<string> {
  const membershipId = generateUuid();
  await client.query(
    `INSERT INTO public.association_memberships (
       id, association_id, person_id, status
     )
     VALUES ($1, $2, $3, 'active')`,
    [membershipId, associationId, personId],
  );

  await client.query(
    `INSERT INTO public.role_assignments (
       id, association_id, membership_id, role_code, scope_type,
       quranic_premise_id, granted_permissions
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      generateUuid(),
      associationId,
      membershipId,
      roleCode,
      scope.scopeType,
      scope.quranicPremiseId ?? null,
      JSON.stringify(ROLE_DEFAULT_PERMISSIONS[roleCode]),
    ],
  );

  return membershipId;
}

async function createIndependentHierarchy(
  client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  associationId: string,
  input: {
    workspaceKind: "independent_mosque" | "independent_quranic_center" | "demo";
    name: string;
    city: string;
    district: string;
    administrativeRegion?: string;
    circleName: string;
    studyPeriod: "after_fajr" | "after_dhuhr" | "after_asr" | "after_maghrib" | "after_isha";
  },
): Promise<{ branchId: string; premiseId: string; circleId: string }> {
  const branchId = generateUuid();
  const premiseId = generateUuid();
  const circleId = generateUuid();

  await client.query(
    `INSERT INTO public.branches (
       id, association_id, city, district, administrative_region
     )
     VALUES ($1, $2, $3, $4, $5)`,
    [
      branchId,
      associationId,
      input.city,
      input.district,
      input.administrativeRegion ?? null,
    ],
  );

  await client.query(
    `INSERT INTO public.quranic_premises (
       id, association_id, branch_id, premise_type, name,
       affiliation_status, operational_status
     )
     VALUES ($1, $2, $3, $4, $5, 'affiliated', 'pending_supervisor')`,
    [
      premiseId,
      associationId,
      branchId,
      input.workspaceKind === "independent_mosque" ? "mosque" : "quranic_center",
      input.name,
    ],
  );

  await client.query(
    `INSERT INTO public.circles (
       id, association_id, quranic_premise_id, name, study_period, operational_status
     )
     VALUES ($1, $2, $3, $4, $5, 'pending_teacher')`,
    [circleId, associationId, premiseId, input.circleName, input.studyPeriod],
  );

  return { branchId, premiseId, circleId };
}

const onboardingRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/onboarding/status",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = getRequiredAuth(request);
      const result = await app.db.query<RegistrationStatusRow>(
        `SELECT
           r.id,
           r.association_id,
           a.name AS association_name,
           r.license_number,
           r.licensing_authority,
           r.status,
           r.decision_reason,
           r.created_at
         FROM public.association_registration_requests r
         INNER JOIN public.associations a ON a.id = r.association_id
         WHERE r.applicant_person_id = $1
           AND r.status = 'pending_verification'
         ORDER BY r.created_at DESC`,
        [auth.personId],
      );

      const memberships = await app.db.query<{ association_id: string; association_name: string; workspace_kind: string }>(
        `SELECT a.id AS association_id, a.name AS association_name, a.workspace_kind
         FROM public.association_memberships m
         INNER JOIN public.associations a ON a.id = m.association_id
         WHERE m.person_id = $1 AND m.status = 'active'
         ORDER BY m.created_at DESC`,
        [auth.personId],
      );

      return reply.status(200).send({
        pendingRegistrations: result.rows,
        workspaces: memberships.rows,
      });
    },
  );

  app.post(
    "/onboarding/association",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 3, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const auth = getRequiredAuth(request);
      const body = associationRegistrationSchema.parse(request.body);
      const duplicate = await app.db.query<{ id: string }>(
        `SELECT id FROM public.association_registration_requests
         WHERE lower(btrim(license_number)) = lower(btrim($1))
           AND lower(btrim(licensing_authority)) = lower(btrim($2))
           AND status = 'pending_verification'
         LIMIT 1`,
        [body.licenseNumber, body.licensingAuthority],
      );
      if (duplicate.rows[0]) {
        throw new ConflictError(
          "يوجد طلب تحقق قيد المراجعة للترخيص نفسه.",
          "DUPLICATE_ASSOCIATION_REGISTRATION",
        );
      }

      const associationId = generateUuid();
      const requestId = generateUuid();
      await withTransaction(app.db, async (client) => {
        await client.query(
          `INSERT INTO public.associations (
             id, name, license_number, license_verified, status, workspace_kind
           )
           VALUES ($1, $2, $3, false, 'pending_verification', 'registered_association')`,
          [associationId, body.name, body.licenseNumber],
        );

        await createEvaluationSettings(client, associationId);

        await client.query(
          `INSERT INTO public.association_registration_requests (
             id, association_id, applicant_person_id, license_number, licensing_authority
           )
           VALUES ($1, $2, $3, $4, $5)`,
          [
            requestId,
            associationId,
            auth.personId,
            body.licenseNumber,
            body.licensingAuthority,
          ],
        );

        const membershipId = generateUuid();
        await client.query(
          `INSERT INTO public.association_memberships (id, association_id, person_id, status)
           VALUES ($1, $2, $3, 'pending')`,
          [membershipId, associationId, auth.personId],
        );
        await client.query(
          `INSERT INTO public.role_assignments (
             id, association_id, membership_id, role_code, scope_type, granted_permissions
           )
           VALUES ($1, $2, $3, 'association_manager', 'association', $4)`,
          [
            generateUuid(),
            associationId,
            membershipId,
            JSON.stringify(ROLE_DEFAULT_PERMISSIONS.association_manager),
          ],
        );

        await recordAuditEvent(client, {
          associationId,
          actorPersonId: auth.personId,
          eventType: "association.registration_submitted",
          entityType: "association_registration_request",
          entityId: requestId,
          newData: {
            licenseNumber: body.licenseNumber,
            licensingAuthority: body.licensingAuthority,
          },
        });
      });

      return reply.status(202).send({
        requestId,
        associationId,
        status: "pending_verification",
        message: "استلمنا بيانات الترخيص. ستبقى الجمعية قيد التحقق حتى اعتماد الجهة المختصة.",
      });
    },
  );

  app.post(
    "/onboarding/independent",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const auth = getRequiredAuth(request);
      const body = independentWorkspaceSchema.parse(request.body);
      const associationId = generateUuid();

      const result = await withTransaction(app.db, async (client) => {
        await client.query(
          `INSERT INTO public.associations (
             id, name, status, workspace_kind, license_verified
           )
           VALUES ($1, $2, 'active', $3, false)`,
          [associationId, body.name, body.workspaceKind],
        );
        await createEvaluationSettings(client, associationId);

        const hierarchy = await createIndependentHierarchy(
          client,
          associationId,
          body,
        );
        const membershipId = await createOwnerMembership(
          client,
          associationId,
          auth.personId,
          "supervisor",
          {
            scopeType: "quranic_premise",
            quranicPremiseId: hierarchy.premiseId,
          },
        );

        await recordAuditEvent(client, {
          associationId,
          actorPersonId: auth.personId,
          actorMembershipId: membershipId,
          eventType: "independent_workspace.created",
          entityType: "association",
          entityId: associationId,
          newData: {
            workspaceKind: body.workspaceKind,
            premiseId: hierarchy.premiseId,
            circleId: hierarchy.circleId,
          },
        });

        return { ...hierarchy, membershipId };
      });

      return reply.status(201).send({
        workspace: {
          associationId,
          name: body.name,
          workspaceKind: body.workspaceKind,
          ...result,
        },
      });
    },
  );

  app.post(
    "/onboarding/demo",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 3, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const auth = getRequiredAuth(request);
      const associationId = generateUuid();
      const fakeNames = ["عبدالله أحمد", "عمر خالد", "يوسف صالح"];
      const sessionDate = "2026-11-25";
      const hijriPeriodKey = "1448-06";

      const result = await withTransaction(app.db, async (client) => {
        await client.query(
          `INSERT INTO public.associations (
             id, name, status, workspace_kind, license_verified
           )
           VALUES ($1, 'بيئة راسخ التجريبية', 'active', 'demo', false)`,
          [associationId],
        );
        await createEvaluationSettings(client, associationId);

        const hierarchy = await createIndependentHierarchy(
          client,
          associationId,
          {
            workspaceKind: "demo",
            name: "مسجد التجربة",
            city: "جدة",
            district: "حي تجريبي",
            circleName: "حلقة النور",
            studyPeriod: "after_fajr",
          },
        );
        const membershipId = await createOwnerMembership(
          client,
          associationId,
          auth.personId,
          "supervisor",
          {
            scopeType: "quranic_premise",
            quranicPremiseId: hierarchy.premiseId,
          },
        );

        for (let i = 0; i < fakeNames.length; i += 1) {
          const fullName = fakeNames[i] ?? "طالب تجريبي";
          const personId = generateUuid();
          let fileNumber: string | null = null;

          for (let attempt = 0; attempt < 5; attempt += 1) {
            const candidate = generateFileNumber(fullName);
            const reserved = await client.query(
              `INSERT INTO public.reserved_file_numbers (file_number)
               VALUES ($1)
               ON CONFLICT (file_number) DO NOTHING
               RETURNING file_number`,
              [candidate],
            );
            if (reserved.rows[0]) {
              fileNumber = candidate;
              break;
            }
          }
          if (!fileNumber) {
            throw new ConflictError("تعذر إنشاء رقم ملف لطالب تجريبي.", "DEMO_FILE_NUMBER_FAILED");
          }

          await client.query(
            `INSERT INTO public.persons (
               id, file_number, full_name, phone, email
             )
             VALUES ($1, $2, $3, NULL, $4)`,
            [
              personId,
              fileNumber,
              fullName,
              `demo-student-${i + 1}-${associationId.slice(0, 8)}@example.invalid`,
            ],
          );

          const studentId = generateUuid();
          await client.query(
            `INSERT INTO public.students (
               id, association_id, person_id, educational_status, previous_memorized_juz
             )
             VALUES ($1, $2, $3, 'active', $4)`,
            [studentId, associationId, personId, i + 1],
          );

          await client.query(
            `INSERT INTO public.student_circle_enrollments (
               id, association_id, student_id, circle_id, recorded_by_membership_id
             )
             VALUES ($1, $2, $3, $4, $5)`,
            [generateUuid(), associationId, studentId, hierarchy.circleId, membershipId],
          );

          await client.query(
            `INSERT INTO public.daily_attendance_records (
               id, association_id, student_id, circle_id, session_date,
               hijri_period_key, status, recorded_by_membership_id
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              generateUuid(),
              associationId,
              studentId,
              hierarchy.circleId,
              sessionDate,
              hijriPeriodKey,
              i === 2 ? "late" : "present",
              membershipId,
            ],
          );

          await client.query(
            `INSERT INTO public.daily_recitation_records (
               id, association_id, student_id, circle_id, session_date,
               hijri_period_key, track, from_surah, from_ayah, to_surah, to_ayah,
               pages_count, daily_rating, quality_multiplier, score_out_of_10,
               recorded_by_membership_id
             )
             VALUES ($1, $2, $3, $4, $5, $6, 'new_memorization', 1, 1, 1, 7,
                     $7, 'excellent', 1.00, 9.50, $8)`,
            [
              generateUuid(),
              associationId,
              studentId,
              hierarchy.circleId,
              sessionDate,
              hijriPeriodKey,
              0.5 + i * 0.25,
              membershipId,
            ],
          );
        }

        await recordAuditEvent(client, {
          associationId,
          actorPersonId: auth.personId,
          actorMembershipId: membershipId,
          eventType: "demo_workspace.created",
          entityType: "association",
          entityId: associationId,
          newData: {
            fakeStudentsCount: fakeNames.length,
            premiseId: hierarchy.premiseId,
            circleId: hierarchy.circleId,
          },
        });

        return { ...hierarchy, membershipId };
      });

      return reply.status(201).send({
        workspace: {
          associationId,
          name: "بيئة راسخ التجريبية",
          workspaceKind: "demo",
          fakeData: true,
          ...result,
        },
      });
    },
  );

  app.post(
    "/onboarding/associations/:associationId/review",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = getRequiredAuth(request);
      if (auth.platformRole !== "platform_admin" && auth.platformRole !== "platform_deputy") {
        throw new ForbiddenError("اعتماد تراخيص الجمعيات متاح لإدارة نظام راسخ فقط.");
      }
      const params = z.object({ associationId: z.string().uuid() }).parse(request.params);
      const body = reviewRegistrationSchema.parse(request.body);

      await withTransaction(app.db, async (client) => {
        const existing = await client.query<{ id: string; applicant_person_id: string }>(
          `SELECT id, applicant_person_id
           FROM public.association_registration_requests
           WHERE association_id = $1 AND status = 'pending_verification'
           FOR UPDATE`,
          [params.associationId],
        );
        const registration = existing.rows[0];
        if (!registration) {
          throw new BadRequestError("طلب تسجيل الجمعية غير موجود أو سبق البت فيه.");
        }

        if (body.decision === "verified") {
          if (!body.confirmedAssociationName) {
            throw new BadRequestError("أدخل الاسم المؤكد للجمعية قبل اعتماد الترخيص.");
          }
          await client.query(
            `UPDATE public.associations
             SET name = $2, status = 'active', license_verified = true, updated_at = now()
             WHERE id = $1`,
            [params.associationId, body.confirmedAssociationName],
          );
          await client.query(
            `UPDATE public.association_memberships
             SET status = 'active', updated_at = now()
             WHERE association_id = $1 AND person_id = $2`,
            [params.associationId, registration.applicant_person_id],
          );
        } else {
          await client.query(
            `UPDATE public.associations
             SET status = 'suspended', license_verified = false, updated_at = now()
             WHERE id = $1`,
            [params.associationId],
          );
          await client.query(
            `UPDATE public.association_memberships
             SET status = 'revoked', valid_until = now(), updated_at = now()
             WHERE association_id = $1 AND person_id = $2`,
            [params.associationId, registration.applicant_person_id],
          );
        }

        await client.query(
          `UPDATE public.association_registration_requests
           SET status = $2,
               verification_method = 'manual_review',
               verification_reference = $3,
               decision_reason = $4,
               reviewed_by_person_id = $5,
               reviewed_at = now(),
               updated_at = now()
           WHERE id = $1`,
          [
            registration.id,
            body.decision,
            body.verificationReference ?? null,
            body.decisionReason ?? null,
            auth.personId,
          ],
        );

        await recordAuditEvent(client, {
          associationId: params.associationId,
          actorPersonId: auth.personId,
          eventType: `association.registration_${body.decision}`,
          entityType: "association_registration_request",
          entityId: registration.id,
          newData: {
            decision: body.decision,
            verificationMethod: "manual_review",
            verificationReference: body.verificationReference ?? null,
          },
          reason: body.decisionReason ?? null,
        });
      });

      return reply.status(200).send({
        associationId: params.associationId,
        status: body.decision,
      });
    },
  );
};

export default onboardingRoutes;
