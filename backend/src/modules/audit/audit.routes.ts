import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuth } from "../../plugins/authentication.js";
import { authorizeAssociationAction } from "../../plugins/authorization.js";

const paramsSchema = z.object({
  associationId: z.string().uuid(),
});

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  entityType: z.string().min(1).max(64).optional(),
});

const auditRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/associations/:associationId/audit-events",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { associationId } = paramsSchema.parse(request.params);
      const { limit, offset, entityType } = querySchema.parse(request.query);

      await authorizeAssociationAction(
        request,
        app.db,
        associationId,
        "audit:read",
      );

      const conditions = ["association_id = $1"];
      const values: unknown[] = [associationId];

      if (entityType) {
        values.push(entityType);
        conditions.push(`entity_type = $${values.length}`);
      }

      values.push(limit, offset);
      const limitParam = `$${values.length - 1}`;
      const offsetParam = `$${values.length}`;

      const result = await app.db.query(
        `SELECT
           id,
           association_id,
           actor_person_id,
           actor_membership_id,
           event_type,
           entity_type,
           entity_id,
           previous_data,
           new_data,
           reason,
           corrects_event_id,
           occurred_at
         FROM public.audit_events
         WHERE ${conditions.join(" AND ")}
         ORDER BY occurred_at DESC
         LIMIT ${limitParam} OFFSET ${offsetParam}`,
        values,
      );

      return reply.status(200).send({
        events: result.rows,
        pagination: { limit, offset, count: result.rows.length },
      });
    },
  );
};

export default auditRoutes;
