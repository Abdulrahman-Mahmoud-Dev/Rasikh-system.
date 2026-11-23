import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { env } from "../../config/env.js";
import { withTransaction } from "../../db/transaction.js";
import { getRequiredAuth, requireAuth } from "../../plugins/authentication.js";
import {
  authorizeAssociationAction,
  canAssignRole,
} from "../../plugins/authorization.js";
import {
  PERMISSIONS,
  ROLE_CODES,
  ROLE_DEFAULT_PERMISSIONS,
  SCOPE_TYPES,
  type RoleCode,
  type ScopeType,
} from "../../shared/domain/constants.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../shared/errors/app-error.js";
import { normalizeSaudiPhone } from "../../shared/utilities/arabic.js";
import {
  generateFileNumber,
  generateOpaqueToken,
  generateUuid,
  hashSecret,
} from "../../shared/utilities/crypto.js";
import { recordAuditEvent } from "../audit/audit.service.js";

const associationParamsSchema = z.object({
  associationId: z.string().uuid(),
});

const requestParamsSchema = z.object({
  associationId: z.string().uuid(),
  requestId: z.string().uuid(),
});

const createPersonSchema = z.object({
  fullName: z.string().trim().min(3).max(200),
  phone: z.string().trim().min(9).max(20),
  email: z.string().trim().email().max(255),
  avatarUrl: z.string().url().optional(),
});

const createInvitationSchema = z.object({
  inviteType: z.enum(["staff_role", "guardian_link"]),
  recipientEmail: z.string().trim().email().max(255).optional(),
  recipientPhone: z.string().trim().min(9).max(20).optional(),
  roleCode: z.enum(ROLE_CODES),
  scopeType: z.enum(SCOPE_TYPES),
  branchId: z.string().uuid().optional(),
  quranicPremiseId: z.string().uuid().optional(),
  circleId: z.string().uuid().optional(),
  targetStudentId: z.string().uuid().optional(),
  relationshipLabel: z.string().trim().min(1).max(64).optional(),
  grantedPermissions: z.array(z.enum(PERMISSIONS)).optional(),
  expiresInHours: z.coerce.number().int().min(1).max(720).default(72),
});

const acceptInvitationSchema = z.object({
  token: z.string().min(16),
});

const createApprovalRequestSchema = z.object({
  requestType: z.enum([
    "promotion_request",
    "responsibility_handover",
    "association_deletion",
  ]),
  targetRoleCode: z.enum(ROLE_CODES).optional(),
  replacementMembershipId: z.string().uuid().optional(),
  justification: z.string().trim().min(3).max(1000),
  payload: z.record(z.unknown()).default({}),
});

const decideApprovalRequestSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(2).max(500),
});

interface InvitationRow {
  id: string;
  association_id: string;
  invite_type: "staff_role" | "guardian_link";
  role_code: RoleCode;
  scope_type: ScopeType;
  branch_id: string | null;
  quranic_premise_id: string | null;
  circle_id: string | null;
  target_student_id: string | null;
  relationship_label: string | null;
  granted_permissions: string[];
  status: string;
  expires_at: Date | string;
}

interface MembershipIdRow {
  id: string;
}

interface ApprovalRequestRow {
  id: string;
  association_id: string;
  request_type:
    | "promotion_request"
    | "responsibility_handover"
    | "association_deletion"
    | "student_transfer";
  requester_membership_id: string;
  target_role_code: RoleCode | null;
  replacement_membership_id: string | null;
  status: string;
}

const peopleRoutes: FastifyPluginAsync = async (app) => {
  // Creates a unified person profile with a permanently reserved AAA-123456 file number
  // and NO automatic role or privilege assignment (Constitution 1.5 Section 4.1).
  app.post(
    "/associations/:associationId/people",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = getRequiredAuth(request);
      const { associationId } = associationParamsSchema.parse(request.params);
      const body = createPersonSchema.parse(request.body);

      const normalizedPhone = normalizeSaudiPhone(body.phone);
      if (!normalizedPhone) {
        throw new BadRequestError(
          "رقم الجوال إلزامي ويجب أن يبدأ بـ 05 ويتكون من 10 أرقام.",
          "INVALID_SAUDI_PHONE",
        );
      }

      const authz = await authorizeAssociationAction(
        request,
        app.db,
        associationId,
        "people:create",
        { allowScopedListEntry: true },
      );

      const normalizedEmail = body.email.trim().toLowerCase();

      const created = await withTransaction(app.db, async (client) => {
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
            "تعذر توليد رقم ملف فريد في الوقت الحالي، حاول مرة أخرى.",
            "FILE_NUMBER_GENERATION_FAILED",
          );
        }

        const personId = generateUuid();
        await client.query(
          `INSERT INTO public.persons (
             id,
             file_number,
             full_name,
             phone,
             email,
             avatar_url
           )
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            personId,
            reservedNumber,
            body.fullName,
            normalizedPhone,
            normalizedEmail,
            body.avatarUrl ?? null,
          ],
        );

        await recordAuditEvent(client, {
          associationId,
          actorPersonId: auth.personId,
          actorMembershipId: authz.membershipId,
          eventType: "person.created",
          entityType: "person",
          entityId: personId,
          newData: {
            fileNumber: reservedNumber,
            fullName: body.fullName,
          },
        });

        return { personId, fileNumber: reservedNumber };
      });

      return reply.status(201).send({
        person: {
          id: created.personId,
          fileNumber: created.fileNumber,
          fullName: body.fullName,
          phone: normalizedPhone,
          email: normalizedEmail,
        },
      });
    },
  );

  app.post(
    "/associations/:associationId/invitations",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = getRequiredAuth(request);
      const { associationId } = associationParamsSchema.parse(request.params);
      const body = createInvitationSchema.parse(request.body);

      if (!body.recipientEmail && !body.recipientPhone) {
        throw new BadRequestError(
          "يجب تحديد البريد الإلكتروني أو رقم الجوال للمدعو.",
          "INVITATION_RECIPIENT_REQUIRED",
        );
      }

      const normalizedPhone = body.recipientPhone
        ? normalizeSaudiPhone(body.recipientPhone)
        : null;
      if (body.recipientPhone && !normalizedPhone) {
        throw new BadRequestError(
          "صيغة رقم جوال المدعو غير صحيحة (يجب أن يبدأ بـ 05).",
          "INVALID_SAUDI_PHONE",
        );
      }

      if (body.inviteType === "guardian_link") {
        if (
          body.roleCode !== "guardian" ||
          body.scopeType !== "guardian_children" ||
          !body.targetStudentId
        ) {
          throw new BadRequestError(
            "دعوة ولي الأمر تتطلب تحديد الطالب وصفة ولي الأمر.",
            "INVALID_GUARDIAN_INVITATION",
          );
        }
      }

      const authz = await authorizeAssociationAction(
        request,
        app.db,
        associationId,
        "invitations:create",
        {
          targetScope: {
            branchId: body.branchId,
            quranicPremiseId: body.quranicPremiseId,
            circleId: body.circleId,
            guardianStudentId: body.targetStudentId,
          },
          allowScopedListEntry: body.inviteType === "guardian_link",
        },
      );

      const permissions =
        body.grantedPermissions ?? [...ROLE_DEFAULT_PERMISSIONS[body.roleCode]];

      if (!canAssignRole(authz.assignments, body.roleCode, permissions)) {
        throw new ForbiddenError(
          "لا يمكنك إسناد دور أو صلاحيات تتجاوز مستواك الإداري.",
          "ROLE_ESCALATION_DENIED",
        );
      }

      const rawToken = generateOpaqueToken();
      const tokenHash = hashSecret(rawToken, env.COOKIE_SECRET);
      const invitationId = generateUuid();
      const expiresAt = new Date(
        Date.now() + body.expiresInHours * 3_600_000,
      );

      await withTransaction(app.db, async (client) => {
        await client.query(
          `INSERT INTO public.invitations (
             id,
             association_id,
             invite_type,
             recipient_email,
             recipient_phone,
             token_hash,
             role_code,
             scope_type,
             branch_id,
             quranic_premise_id,
             circle_id,
             target_student_id,
             relationship_label,
             granted_permissions,
             invited_by_person_id,
             expires_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            invitationId,
            associationId,
            body.inviteType,
            body.recipientEmail?.trim().toLowerCase() ?? null,
            normalizedPhone,
            tokenHash,
            body.roleCode,
            body.scopeType,
            body.branchId ?? null,
            body.quranicPremiseId ?? null,
            body.circleId ?? null,
            body.targetStudentId ?? null,
            body.relationshipLabel ?? null,
            JSON.stringify(permissions),
            auth.personId,
            expiresAt.toISOString(),
          ],
        );

        await recordAuditEvent(client, {
          associationId,
          actorPersonId: auth.personId,
          actorMembershipId: authz.membershipId,
          eventType: "invitation.created",
          entityType: "invitation",
          entityId: invitationId,
          newData: {
            inviteType: body.inviteType,
            roleCode: body.roleCode,
            scopeType: body.scopeType,
          },
        });
      });

      return reply.status(201).send({
        invitation: {
          id: invitationId,
          inviteType: body.inviteType,
          roleCode: body.roleCode,
          expiresAt: expiresAt.toISOString(),
        },
      });
    },
  );

  app.post(
    "/invitations/accept",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = getRequiredAuth(request);
      const body = acceptInvitationSchema.parse(request.body);
      const tokenHash = hashSecret(body.token, env.COOKIE_SECRET);

      const accepted = await withTransaction(app.db, async (client) => {
        const invRes = await client.query<InvitationRow>(
          `SELECT
             id,
             association_id,
             invite_type,
             role_code,
             scope_type,
             branch_id,
             quranic_premise_id,
             circle_id,
             target_student_id,
             relationship_label,
             granted_permissions,
             status,
             expires_at
           FROM public.invitations
           WHERE token_hash = $1
           LIMIT 1
           FOR UPDATE`,
          [tokenHash],
        );

        const inv = invRes.rows[0];
        if (!inv || inv.status !== "pending") {
          throw new BadRequestError(
            "الدعوة غير صالحة أو سبق قبولها.",
            "INVALID_INVITATION",
          );
        }

        if (new Date(inv.expires_at).getTime() <= Date.now()) {
          await client.query(
            `UPDATE public.invitations SET status = 'expired' WHERE id = $1`,
            [inv.id],
          );
          throw new BadRequestError(
            "انتهت صلاحية هذه الدعوة.",
            "INVITATION_EXPIRED",
          );
        }

        const membershipRes = await client.query<MembershipIdRow>(
          `SELECT id
           FROM public.association_memberships
           WHERE association_id = $1 AND person_id = $2
           LIMIT 1`,
          [inv.association_id, auth.personId],
        );

        let membershipId = membershipRes.rows[0]?.id;
        if (!membershipId) {
          membershipId = generateUuid();
          await client.query(
            `INSERT INTO public.association_memberships (
               id, association_id, person_id, status
             )
             VALUES ($1, $2, $3, 'active')`,
            [membershipId, inv.association_id, auth.personId],
          );
        } else {
          await client.query(
            `UPDATE public.association_memberships
             SET status = 'active', valid_until = NULL, updated_at = now()
             WHERE id = $1`,
            [membershipId],
          );
        }

        const assignmentId = generateUuid();
        await client.query(
          `INSERT INTO public.role_assignments (
             id,
             association_id,
             membership_id,
             role_code,
             scope_type,
             branch_id,
             quranic_premise_id,
             circle_id,
             granted_permissions
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            assignmentId,
            inv.association_id,
            membershipId,
            inv.role_code,
            inv.scope_type,
            inv.branch_id,
            inv.quranic_premise_id,
            inv.circle_id,
            JSON.stringify(inv.granted_permissions),
          ],
        );

        if (inv.invite_type === "guardian_link" && inv.target_student_id) {
          await client.query(
            `INSERT INTO public.guardian_student_links (
               id,
               association_id,
               guardian_membership_id,
               student_id,
               relationship_label
             )
             VALUES ($1, $2, $3, $4, $5)`,
            [
              generateUuid(),
              inv.association_id,
              membershipId,
              inv.target_student_id,
              inv.relationship_label ?? "ولي أمر",
            ],
          );
        }

        await client.query(
          `UPDATE public.invitations
           SET status = 'accepted',
               accepted_by_person_id = $2,
               accepted_at = now()
           WHERE id = $1`,
          [inv.id, auth.personId],
        );

        await recordAuditEvent(client, {
          associationId: inv.association_id,
          actorPersonId: auth.personId,
          actorMembershipId: membershipId,
          eventType: "invitation.accepted",
          entityType: "invitation",
          entityId: inv.id,
          newData: {
            roleCode: inv.role_code,
            scopeType: inv.scope_type,
          },
        });

        return {
          associationId: inv.association_id,
          membershipId,
          assignmentId,
          roleCode: inv.role_code,
        };
      });

      return reply.status(200).send({
        accepted,
      });
    },
  );

  // Sensitive requests: promotion, responsibility handover (requires replacement),
  // or association deletion (requires consensus of manager + deputy + branch managers).
  app.post(
    "/associations/:associationId/requests",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = getRequiredAuth(request);
      const { associationId } = associationParamsSchema.parse(request.params);
      const body = createApprovalRequestSchema.parse(request.body);

      const authz = await authorizeAssociationAction(
        request,
        app.db,
        associationId,
        "requests:create",
        { allowScopedListEntry: true },
      );

      if (
        body.requestType === "responsibility_handover" &&
        !body.replacementMembershipId
      ) {
        throw new BadRequestError(
          "إنهاء المسؤولية يتطلب تحديد بديل معتمد أولاً (الدستور ٣.١).",
          "REPLACEMENT_REQUIRED",
        );
      }

      const requestId = generateUuid();
      await withTransaction(app.db, async (client) => {
        await client.query(
          `INSERT INTO public.approval_requests (
             id,
             association_id,
             request_type,
             requester_membership_id,
             target_role_code,
             replacement_membership_id,
             payload,
             justification
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            requestId,
            associationId,
            body.requestType,
            authz.membershipId,
            body.targetRoleCode ?? null,
            body.replacementMembershipId ?? null,
            JSON.stringify(body.payload),
            body.justification,
          ],
        );

        await recordAuditEvent(client, {
          associationId,
          actorPersonId: auth.personId,
          actorMembershipId: authz.membershipId,
          eventType: "approval_request.created",
          entityType: "approval_request",
          entityId: requestId,
          newData: {
            requestType: body.requestType,
            targetRoleCode: body.targetRoleCode ?? null,
          },
          reason: body.justification,
        });
      });

      return reply.status(201).send({
        request: {
          id: requestId,
          associationId,
          requestType: body.requestType,
          status: "pending",
        },
      });
    },
  );

  app.patch(
    "/associations/:associationId/requests/:requestId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = getRequiredAuth(request);
      const { associationId, requestId } = requestParamsSchema.parse(
        request.params,
      );
      const body = decideApprovalRequestSchema.parse(request.body);

      const authz = await authorizeAssociationAction(
        request,
        app.db,
        associationId,
        "requests:decide",
      );

      const outcome = await withTransaction(app.db, async (client) => {
        const reqRes = await client.query<ApprovalRequestRow>(
          `SELECT
             id,
             association_id,
             request_type,
             requester_membership_id,
             target_role_code,
             replacement_membership_id,
             status
           FROM public.approval_requests
           WHERE id = $1 AND association_id = $2
           LIMIT 1
           FOR UPDATE`,
          [requestId, associationId],
        );

        const approvalReq = reqRes.rows[0];
        if (!approvalReq) {
          throw new NotFoundError(
            "الطلب الإداري غير موجود.",
            "APPROVAL_REQUEST_NOT_FOUND",
          );
        }

        if (approvalReq.status !== "pending") {
          throw new ConflictError(
            "تم البت في هذا الطلب مسبقًا.",
            "APPROVAL_REQUEST_ALREADY_DECIDED",
          );
        }

        if (approvalReq.request_type === "association_deletion") {
          const voterRole = authz.assignments[0]?.roleCode ?? "association_manager";
          await client.query(
            `INSERT INTO public.approval_request_votes (
               id,
               association_id,
               request_id,
               voter_membership_id,
               voter_role_code,
               decision,
               reason
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (request_id, voter_membership_id)
             DO UPDATE SET decision = EXCLUDED.decision, reason = EXCLUDED.reason, voted_at = now()`,
            [
              generateUuid(),
              associationId,
              requestId,
              authz.membershipId,
              voterRole,
              body.decision,
              body.reason,
            ],
          );

          if (body.decision === "rejected") {
            await client.query(
              `UPDATE public.approval_requests
               SET status = 'rejected',
                   decision_reason = $2,
                   decided_by_membership_id = $3,
                   decided_at = now()
               WHERE id = $1`,
              [requestId, body.reason, authz.membershipId],
            );
            return { status: "rejected" };
          }

          return { status: "vote_recorded" };
        }

        await client.query(
          `UPDATE public.approval_requests
           SET status = $2,
               decision_reason = $3,
               decided_by_membership_id = $4,
               decided_at = now()
           WHERE id = $1`,
          [requestId, body.decision, body.reason, authz.membershipId],
        );

        await recordAuditEvent(client, {
          associationId,
          actorPersonId: auth.personId,
          actorMembershipId: authz.membershipId,
          eventType: `approval_request.${body.decision}`,
          entityType: "approval_request",
          entityId: requestId,
          reason: body.reason,
        });

        return { status: body.decision };
      });

      return reply.status(200).send({
        requestId,
        outcome: outcome.status,
      });
    },
  );
};

export default peopleRoutes;
