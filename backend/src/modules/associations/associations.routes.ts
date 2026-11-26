import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { withTransaction } from "../../db/transaction.js";
import { getRequiredAuth, requireAuth } from "../../plugins/authentication.js";
import {
  authorizeAssociationAction,
  extractScopeSets,
} from "../../plugins/authorization.js";
import {
  PREMISE_TYPES,
  STUDY_PERIODS,
} from "../../shared/domain/constants.js";
import {
  ForbiddenError,
  NotFoundError,
} from "../../shared/errors/app-error.js";
import { generateUuid } from "../../shared/utilities/crypto.js";
import { recordAuditEvent } from "../audit/audit.service.js";

const associationParamsSchema = z.object({
  associationId: z.string().uuid(),
});

const createAssociationSchema = z.object({
  name: z.string().trim().min(2).max(200),
  licenseNumber: z.string().trim().min(2).max(100).optional(),
  licenseVerified: z.boolean().default(false),
});

const createPremiseSchema = z.object({
  premiseType: z.enum(PREMISE_TYPES),
  name: z.string().trim().min(2).max(200),
  city: z.string().trim().min(2).max(120),
  district: z.string().trim().min(2).max(120),
  administrativeRegion: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  imageUrl: z.string().url().optional(),
});

const createCircleSchema = z.object({
  quranicPremiseId: z.string().uuid(),
  name: z.string().trim().min(2).max(200),
  studyPeriod: z.enum(STUDY_PERIODS),
  targetStage: z.string().trim().min(1).max(120).optional(),
  teacherMembershipId: z.string().uuid().optional(),
});

interface BranchIdRow {
  id: string;
}

interface PremiseLookupRow {
  id: string;
  branch_id: string;
  operational_status: string;
}

const associationsRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/associations",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = getRequiredAuth(request);
      if (
        auth.platformRole !== "platform_admin" &&
        auth.platformRole !== "platform_deputy"
      ) {
        throw new ForbiddenError(
          "إنشاء جمعية جديدة متاح لإدارة نظام راسخ فقط.",
          "PLATFORM_ADMIN_REQUIRED",
        );
      }

      const body = createAssociationSchema.parse(request.body);
      const associationId = generateUuid();
      const settingsId = generateUuid();

      await withTransaction(app.db, async (client) => {
        await client.query(
          `INSERT INTO public.associations (id, name, license_number, license_verified)
           VALUES ($1, $2, $3, $4)`,
          [
            associationId,
            body.name,
            body.licenseNumber ?? null,
            body.licenseVerified,
          ],
        );

        await client.query(
          `INSERT INTO public.association_evaluation_settings (id, association_id)
           VALUES ($1, $2)`,
          [settingsId, associationId],
        );

        await recordAuditEvent(client, {
          associationId,
          actorPersonId: auth.personId,
          eventType: "association.created",
          entityType: "association",
          entityId: associationId,
          newData: {
            name: body.name,
            licenseNumber: body.licenseNumber ?? null,
          },
        });
      });

      return reply.status(201).send({
        association: {
          id: associationId,
          name: body.name,
          licenseNumber: body.licenseNumber ?? null,
          licenseVerified: body.licenseVerified,
        },
      });
    },
  );

  app.get(
    "/associations/:associationId/hierarchy",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { associationId } = associationParamsSchema.parse(request.params);
      const query = z.object({ circleId: z.string().uuid().optional() }).parse(request.query);
      const authz = await authorizeAssociationAction(
        request,
        app.db,
        associationId,
        "circles:read",
        { allowScopedListEntry: true },
      );

      const scopes = extractScopeSets(authz.assignments, "circles:read");

      if (
        !scopes.hasAssociationScope &&
        scopes.branchIds.length === 0 &&
        scopes.premiseIds.length === 0 &&
        scopes.circleIds.length === 0
      ) {
        return reply.status(200).send({ items: [] });
      }

      if (
        query.circleId &&
        !scopes.hasAssociationScope &&
        !scopes.circleIds.includes(query.circleId)
      ) {
        throw new ForbiddenError(
          "الحلقة المطلوبة خارج نطاق تكليفك.",
          "CIRCLE_SCOPE_DENIED",
        );
      }

      let filterPredicate = scopes.hasAssociationScope
        ? "TRUE"
        : `(
             qp.branch_id = ANY($2::uuid[])
             OR qp.id = ANY($3::uuid[])
             OR c.id = ANY($4::uuid[])
           )`;

      const queryParams: unknown[] = scopes.hasAssociationScope
        ? [associationId]
        : [
            associationId,
            scopes.branchIds,
            scopes.premiseIds,
            scopes.circleIds,
          ];

      if (query.circleId) {
        queryParams.push(query.circleId);
        filterPredicate = `c.id = ${queryParams.length}::uuid`;
      }

      const rowsRes = await app.db.query(
        `SELECT
           b.id AS branch_id,
           b.city,
           b.district,
           b.administrative_region,
           b.display_name AS branch_display_name,
           qp.id AS premise_id,
           qp.premise_type,
           qp.name AS premise_name,
           qp.operational_status AS premise_status,
           c.id AS circle_id,
           c.name AS circle_name,
           c.study_period,
           c.target_stage,
           c.operational_status AS circle_status
         FROM public.branches b
         LEFT JOIN public.quranic_premises qp
           ON qp.branch_id = b.id AND qp.association_id = b.association_id
         LEFT JOIN public.circles c
           ON c.quranic_premise_id = qp.id AND c.association_id = qp.association_id
         WHERE b.association_id = $1
           AND ${filterPredicate}
         ORDER BY b.display_name ASC, qp.name ASC NULLS LAST, c.name ASC NULLS LAST`,
        queryParams,
      );

      return reply.status(200).send({
        items: rowsRes.rows,
      });
    },
  );

  // Creates a Mosque or Qur'anic Center and automatically resolves/creates its geographic Branch.
  app.post(
    "/associations/:associationId/premises",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = getRequiredAuth(request);
      const { associationId } = associationParamsSchema.parse(request.params);
      const body = createPremiseSchema.parse(request.body);

      const authz = await authorizeAssociationAction(
        request,
        app.db,
        associationId,
        "premises:create",
        { allowScopedListEntry: true },
      );

      const created = await withTransaction(app.db, async (client) => {
        const regionValue = body.administrativeRegion ?? null;

        const existingBranch = await client.query<BranchIdRow>(
          `SELECT id
           FROM public.branches
           WHERE association_id = $1
             AND lower(btrim(city)) = lower(btrim($2))
             AND lower(btrim(district)) = lower(btrim($3))
             AND coalesce(lower(btrim(administrative_region)), '') = coalesce(lower(btrim($4)), '')
           LIMIT 1`,
          [associationId, body.city, body.district, regionValue],
        );

        let branchId = existingBranch.rows[0]?.id;
        if (!branchId) {
          branchId = generateUuid();
          await client.query(
            `INSERT INTO public.branches (id, association_id, city, district, administrative_region)
             VALUES ($1, $2, $3, $4, $5)`,
            [branchId, associationId, body.city, body.district, regionValue],
          );
        }

        // Verify caller actually holds association-wide scope or scope on this resolved branch.
        await authorizeAssociationAction(
          request,
          client,
          associationId,
          "premises:create",
          { targetScope: { branchId } },
        );

        const premiseId = generateUuid();
        await client.query(
          `INSERT INTO public.quranic_premises (
             id,
             association_id,
             branch_id,
             premise_type,
             name,
             description,
             image_url,
             affiliation_status,
             operational_status
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'affiliated', 'pending_circle')`,
          [
            premiseId,
            associationId,
            branchId,
            body.premiseType,
            body.name,
            body.description ?? null,
            body.imageUrl ?? null,
          ],
        );

        await recordAuditEvent(client, {
          associationId,
          actorPersonId: auth.personId,
          actorMembershipId: authz.membershipId,
          eventType: "premise.created",
          entityType: "quranic_premise",
          entityId: premiseId,
          newData: {
            premiseType: body.premiseType,
            name: body.name,
            branchId,
          },
        });

        return { premiseId, branchId };
      });

      return reply.status(201).send({
        premise: {
          id: created.premiseId,
          associationId,
          branchId: created.branchId,
          premiseType: body.premiseType,
          name: body.name,
          operationalStatus: "pending_circle",
        },
      });
    },
  );

  // Creates a Circle attached strictly to a Mosque/Qur'anic Center (Constitution 2.4).
  app.post(
    "/associations/:associationId/circles",
    { preHandler: requireAuth },
    async (request, reply) => {
      const auth = getRequiredAuth(request);
      const { associationId } = associationParamsSchema.parse(request.params);
      const body = createCircleSchema.parse(request.body);

      const result = await withTransaction(app.db, async (client) => {
        const premiseRes = await client.query<PremiseLookupRow>(
          `SELECT id, branch_id, operational_status
           FROM public.quranic_premises
           WHERE id = $1 AND association_id = $2
           LIMIT 1`,
          [body.quranicPremiseId, associationId],
        );

        const premise = premiseRes.rows[0];
        if (!premise) {
          throw new NotFoundError(
            "المسجد أو المقر القرآني المحدد غير موجود في هذه الجمعية.",
            "PREMISE_NOT_FOUND",
          );
        }

        const authz = await authorizeAssociationAction(
          request,
          client,
          associationId,
          "circles:create",
          {
            targetScope: {
              branchId: premise.branch_id,
              quranicPremiseId: premise.id,
            },
          },
        );

        const circleId = generateUuid();
        const operationalStatus = body.teacherMembershipId
          ? "active"
          : "pending_teacher";

        await client.query(
          `INSERT INTO public.circles (
             id,
             association_id,
             quranic_premise_id,
             name,
             study_period,
             target_stage,
             operational_status
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            circleId,
            associationId,
            premise.id,
            body.name,
            body.studyPeriod,
            body.targetStage ?? null,
            operationalStatus,
          ],
        );

        if (premise.operational_status === "pending_circle") {
          await client.query(
            `UPDATE public.quranic_premises
             SET operational_status = 'pending_supervisor', updated_at = now()
             WHERE id = $1`,
            [premise.id],
          );
        }

        await recordAuditEvent(client, {
          associationId,
          actorPersonId: auth.personId,
          actorMembershipId: authz.membershipId,
          eventType: "circle.created",
          entityType: "circle",
          entityId: circleId,
          newData: {
            name: body.name,
            quranicPremiseId: premise.id,
            studyPeriod: body.studyPeriod,
            targetStage: body.targetStage ?? null,
            operationalStatus,
          },
        });

        return { circleId, operationalStatus };
      });

      return reply.status(201).send({
        circle: {
          id: result.circleId,
          associationId,
          quranicPremiseId: body.quranicPremiseId,
          name: body.name,
          studyPeriod: body.studyPeriod,
          targetStage: body.targetStage ?? null,
          operationalStatus: result.operationalStatus,
        },
      });
    },
  );
};

export default associationsRoutes;
