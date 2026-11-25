import type { Queryable } from "../../db/transaction.js";
import { generateUuid } from "../../shared/utilities/crypto.js";

export interface RecordAuditEventInput {
  associationId: string | null;
  actorPersonId: string | null;
  actorMembershipId?: string | null;
  eventType: string;
  entityType: string;
  entityId?: string | null;
  previousData?: unknown;
  newData?: unknown;
  reason?: string | null;
  correctsEventId?: string | null;
}

export async function recordAuditEvent(
  db: Queryable,
  input: RecordAuditEventInput,
): Promise<string> {
  const id = generateUuid();
  await db.query(
    `INSERT INTO public.audit_events (
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
       corrects_event_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      input.associationId,
      input.actorPersonId,
      input.actorMembershipId ?? null,
      input.eventType,
      input.entityType,
      input.entityId ?? null,
      input.previousData !== undefined
        ? JSON.stringify(input.previousData)
        : null,
      input.newData !== undefined ? JSON.stringify(input.newData) : null,
      input.reason ?? null,
      input.correctsEventId ?? null,
    ],
  );
  return id;
}
