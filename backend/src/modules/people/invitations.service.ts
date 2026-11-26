import type { Queryable } from "../../db/transaction.js";
import type { RoleCode, ScopeType } from "../../shared/domain/constants.js";
import { recordAuditEvent } from "../audit/audit.service.js";
import { generateUuid } from "../../shared/utilities/crypto.js";

interface InvitationRow {
  id: string;
  association_id: string;
  invite_type: "staff_role" | "guardian_link";
  recipient_email: string | null;
  role_code: RoleCode;
  scope_type: ScopeType;
  branch_id: string | null;
  quranic_premise_id: string | null;
  circle_id: string | null;
  target_student_id: string | null;
  relationship_label: string | null;
  granted_permissions: string[];
  invited_by_person_id: string;
  status: string;
  expires_at: Date | string;
}

export interface ApplyInvitationResult {
  invitationId: string;
  associationId: string;
  membershipId: string;
  assignmentId: string | null;
  roleCode: RoleCode;
}

/**
 * Assigns a stored invitation to a person after that person's email ownership
 * has been established by an email-link confirmation or an authoritative
 * Google identity. The raw invitation token is not needed or disclosed.
 */
export async function applyInvitationToPerson(
  db: Queryable,
  invitation: InvitationRow,
  personId: string,
  normalizedEmail: string,
): Promise<ApplyInvitationResult | null> {
  if (
    invitation.status !== "pending" ||
    !invitation.recipient_email ||
    invitation.recipient_email.trim().toLowerCase() !== normalizedEmail
  ) {
    return null;
  }

  if (new Date(invitation.expires_at).getTime() <= Date.now()) {
    await db.query(
      "UPDATE public.invitations SET status = 'expired' WHERE id = $1 AND status = 'pending'",
      [invitation.id],
    );
    return null;
  }

  const membershipResult = await db.query<{
    id: string;
    status: string;
  }>(
    `SELECT id, status
     FROM public.association_memberships
     WHERE association_id = $1 AND person_id = $2
     LIMIT 1
     FOR UPDATE`,
    [invitation.association_id, personId],
  );

  let membershipId = membershipResult.rows[0]?.id;
  const membershipStatus = membershipResult.rows[0]?.status;

  if (membershipStatus === "suspended") {
    // A new invitation must not silently undo an explicit suspension.
    return null;
  }

  if (!membershipId) {
    membershipId = generateUuid();
    await db.query(
      `INSERT INTO public.association_memberships (id, association_id, person_id, status)
       VALUES ($1, $2, $3, 'active')`,
      [membershipId, invitation.association_id, personId],
    );
  } else if (membershipStatus !== "active") {
    // A fresh, authorized invitation can reactivate an ended/revoked membership;
    // prior role assignments remain in the audit/history.
    await db.query(
      `UPDATE public.role_assignments
       SET valid_until = now()
       WHERE membership_id = $1
         AND association_id = $2
         AND valid_from <= now()
         AND valid_until IS NULL`,
      [membershipId, invitation.association_id],
    );
    await db.query(
      `UPDATE public.association_memberships
       SET status = 'active', valid_from = now(), valid_until = NULL, updated_at = now()
       WHERE id = $1`,
      [membershipId],
    );
  }

  const existingAssignment = await db.query<{ id: string }>(
    `SELECT id
     FROM public.role_assignments
     WHERE association_id = $1
       AND membership_id = $2
       AND role_code = $3
       AND scope_type = $4
       AND branch_id IS NOT DISTINCT FROM $5::uuid
       AND quranic_premise_id IS NOT DISTINCT FROM $6::uuid
       AND circle_id IS NOT DISTINCT FROM $7::uuid
       AND valid_from <= now()
       AND (valid_until IS NULL OR valid_until > now())
     LIMIT 1
     FOR UPDATE`,
    [
      invitation.association_id,
      membershipId,
      invitation.role_code,
      invitation.scope_type,
      invitation.branch_id,
      invitation.quranic_premise_id,
      invitation.circle_id,
    ],
  );

  let assignmentId = existingAssignment.rows[0]?.id ?? null;
  if (!assignmentId) {
    assignmentId = generateUuid();
    await db.query(
      `INSERT INTO public.role_assignments (
         id, association_id, membership_id, role_code, scope_type,
         branch_id, quranic_premise_id, circle_id, granted_permissions
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        assignmentId,
        invitation.association_id,
        membershipId,
        invitation.role_code,
        invitation.scope_type,
        invitation.branch_id,
        invitation.quranic_premise_id,
        invitation.circle_id,
        JSON.stringify(invitation.granted_permissions),
      ],
    );
  }

  if (invitation.invite_type === "guardian_link" && invitation.target_student_id) {
    await db.query(
      `INSERT INTO public.guardian_student_links (
         id, association_id, guardian_membership_id, student_id, relationship_label
       )
       SELECT $1, $2, $3, $4, $5
       WHERE NOT EXISTS (
         SELECT 1
         FROM public.guardian_student_links
         WHERE association_id = $2
           AND guardian_membership_id = $3
           AND student_id = $4
           AND valid_until IS NULL
       )`,
      [
        generateUuid(),
        invitation.association_id,
        membershipId,
        invitation.target_student_id,
        invitation.relationship_label ?? "ولي أمر",
      ],
    );
  }

  await db.query(
    `UPDATE public.invitations
     SET status = 'accepted', accepted_by_person_id = $2, accepted_at = now()
     WHERE id = $1 AND status = 'pending'`,
    [invitation.id, personId],
  );

  await recordAuditEvent(db, {
    associationId: invitation.association_id,
    actorPersonId: personId,
    actorMembershipId: membershipId,
    eventType: "invitation.auto_assigned",
    entityType: "invitation",
    entityId: invitation.id,
    newData: {
      roleCode: invitation.role_code,
      scopeType: invitation.scope_type,
      circleId: invitation.circle_id,
      assignedFromMatchingEmail: true,
    },
    reason: "تفعيل الدعوة تلقائيًا بعد تسجيل الدخول بالبريد المطابق والتحقق من ملكيته.",
  });

  return {
    invitationId: invitation.id,
    associationId: invitation.association_id,
    membershipId,
    assignmentId,
    roleCode: invitation.role_code,
  };
}

/**
 * Applies every unexpired pending invitation that exactly matches the verified
 * email. Multiple associations/circles are deliberately kept as separate
 * assignments so the user can choose the correct workspace after sign-in.
 */
export async function applyPendingInvitationsForPerson(
  db: Queryable,
  personId: string,
  email: string,
): Promise<ApplyInvitationResult[]> {
  const normalizedEmail = email.trim().toLowerCase();
  const invitations = await db.query<InvitationRow>(
    `SELECT
       id, association_id, invite_type, recipient_email, role_code, scope_type,
       branch_id, quranic_premise_id, circle_id, target_student_id,
       relationship_label, granted_permissions, invited_by_person_id,
       status, expires_at
     FROM public.invitations
     WHERE lower(btrim(recipient_email)) = $1
       AND status = 'pending'
     ORDER BY created_at ASC, id ASC
     FOR UPDATE`,
    [normalizedEmail],
  );

  const applied: ApplyInvitationResult[] = [];
  for (const invitation of invitations.rows) {
    const result = await applyInvitationToPerson(
      db,
      invitation,
      personId,
      normalizedEmail,
    );
    if (result) applied.push(result);
  }
  return applied;
}
