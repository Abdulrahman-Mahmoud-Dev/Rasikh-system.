import type { FastifyRequest } from "fastify";

import type { Queryable } from "../db/transaction.js";
import {
  ROLE_ASSIGNABLE_ROLES,
  ROLE_DEFAULT_PERMISSIONS,
  type Permission,
  type RoleCode,
  type ScopeType,
} from "../shared/domain/constants.js";
import { ForbiddenError } from "../shared/errors/app-error.js";
import { getRequiredAuth } from "./authentication.js";

export interface RoleAssignmentRecord {
  id: string;
  associationId: string;
  membershipId: string;
  roleCode: RoleCode;
  scopeType: ScopeType;
  branchId: string | null;
  quranicPremiseId: string | null;
  circleId: string | null;
  grantedPermissions: readonly string[];
}

export interface TargetScope {
  associationId: string;
  branchId?: string | null;
  quranicPremiseId?: string | null;
  circleId?: string | null;
  guardianStudentId?: string | null;
}

export interface AuthorizationContext {
  associationId: string;
  membershipId: string;
  assignments: readonly RoleAssignmentRecord[];
}

interface AssignmentRow {
  membership_id: string;
  assignment_id: string;
  role_code: RoleCode;
  scope_type: ScopeType;
  branch_id: string | null;
  quranic_premise_id: string | null;
  circle_id: string | null;
  granted_permissions: string[];
}

/**
 * Checks whether a granter's active role assignments permit assigning
 * `targetRole` with `targetPermissions` (prevents self-promotion, upward escalation,
 * and granting permissions outside the role's ceiling or the granter's authority).
 */
export function canAssignRole(
  granterAssignments: readonly RoleAssignmentRecord[],
  targetRole: RoleCode,
  targetPermissions: readonly string[],
): boolean {
  const roleCeiling = new Set<string>(ROLE_DEFAULT_PERMISSIONS[targetRole]);

  return granterAssignments.some((assignment) => {
    const canGrant =
      assignment.grantedPermissions.includes("roles:assign") ||
      assignment.grantedPermissions.includes("invitations:create");

    if (!canGrant) {
      return false;
    }

    const assignableRoles = ROLE_ASSIGNABLE_ROLES[assignment.roleCode];
    if (!assignableRoles.includes(targetRole)) {
      return false;
    }

    const granterPerms = new Set(assignment.grantedPermissions);
    return targetPermissions.every(
      (perm) => granterPerms.has(perm) && roleCeiling.has(perm),
    );
  });
}

/**
 * Evaluates whether any active role assignment in `assignments` grants `permission`
 * over `targetScope`. Lower scopes NEVER inherit upward permissions.
 */
export function evaluatePermission(
  assignments: readonly RoleAssignmentRecord[],
  permission: Permission,
  targetScope: TargetScope,
  options?: { allowScopedListEntry?: boolean },
): boolean {
  const allowListEntry = options?.allowScopedListEntry ?? false;

  return assignments.some((assignment) => {
    if (assignment.associationId !== targetScope.associationId) {
      return false;
    }

    if (!assignment.grantedPermissions.includes(permission)) {
      return false;
    }

    if (allowListEntry) {
      return true;
    }

    switch (assignment.scopeType) {
      case "association":
        return true;
      case "branch":
        return (
          Boolean(assignment.branchId) &&
          targetScope.branchId === assignment.branchId
        );
      case "quranic_premise":
        return (
          Boolean(assignment.quranicPremiseId) &&
          targetScope.quranicPremiseId === assignment.quranicPremiseId
        );
      case "circle":
        return (
          Boolean(assignment.circleId) &&
          targetScope.circleId === assignment.circleId
        );
      case "guardian_children":
        return (
          (permission === "students:read" || permission === "reports:read") &&
          Boolean(targetScope.guardianStudentId)
        );
      default:
        return false;
    }
  });
}

export async function loadAssociationAuthorization(
  db: Queryable,
  personId: string,
  associationId: string,
): Promise<AuthorizationContext | null> {
  const result = await db.query<AssignmentRow>(
    `SELECT
       m.id AS membership_id,
       ra.id AS assignment_id,
       ra.role_code,
       ra.scope_type,
       ra.branch_id,
       ra.quranic_premise_id,
       ra.circle_id,
       ra.granted_permissions
     FROM public.association_memberships m
     INNER JOIN public.role_assignments ra
       ON ra.membership_id = m.id AND ra.association_id = m.association_id
     WHERE m.person_id = $1
       AND m.association_id = $2
       AND m.status = 'active'
       AND m.valid_from <= now()
       AND (m.valid_until IS NULL OR m.valid_until > now())
       AND ra.valid_from <= now()
       AND (ra.valid_until IS NULL OR ra.valid_until > now())`,
    [personId, associationId],
  );

  const first = result.rows[0];
  if (!first) {
    return null;
  }

  return {
    associationId,
    membershipId: first.membership_id,
    assignments: result.rows.map((row) => ({
      id: row.assignment_id,
      associationId,
      membershipId: row.membership_id,
      roleCode: row.role_code,
      scopeType: row.scope_type,
      branchId: row.branch_id,
      quranicPremiseId: row.quranic_premise_id,
      circleId: row.circle_id,
      grantedPermissions: Array.isArray(row.granted_permissions)
        ? row.granted_permissions
        : [],
    })),
  };
}

export async function authorizeAssociationAction(
  request: FastifyRequest,
  db: Queryable,
  associationId: string,
  permission: Permission,
  options?: {
    targetScope?: Omit<TargetScope, "associationId">;
    allowScopedListEntry?: boolean;
  },
): Promise<AuthorizationContext> {
  const auth = getRequiredAuth(request);
  const authz = await loadAssociationAuthorization(
    db,
    auth.personId,
    associationId,
  );

  if (!authz) {
    throw new ForbiddenError(
      "ليست لديك عضوية نشطة في هذه الجمعية.",
      "ASSOCIATION_ACCESS_DENIED",
    );
  }

  const allowed = evaluatePermission(
    authz.assignments,
    permission,
    {
      associationId,
      ...options?.targetScope,
    },
    { allowScopedListEntry: options?.allowScopedListEntry },
  );

  if (!allowed) {
    throw new ForbiddenError();
  }

  return authz;
}

export function isGuardianOnly(
  assignments: readonly RoleAssignmentRecord[],
): boolean {
  return (
    assignments.length > 0 &&
    assignments.every((a) => a.roleCode === "guardian")
  );
}

export interface ScopeSets {
  hasAssociationScope: boolean;
  branchIds: string[];
  premiseIds: string[];
  circleIds: string[];
  hasGuardianScope: boolean;
}

export function extractScopeSets(
  assignments: readonly RoleAssignmentRecord[],
  permission: Permission,
): ScopeSets {
  const branchIds = new Set<string>();
  const premiseIds = new Set<string>();
  const circleIds = new Set<string>();
  let hasAssociationScope = false;
  let hasGuardianScope = false;

  for (const assignment of assignments) {
    if (!assignment.grantedPermissions.includes(permission)) {
      continue;
    }

    switch (assignment.scopeType) {
      case "association":
        hasAssociationScope = true;
        break;
      case "branch":
        if (assignment.branchId) branchIds.add(assignment.branchId);
        break;
      case "quranic_premise":
        if (assignment.quranicPremiseId) {
          premiseIds.add(assignment.quranicPremiseId);
        }
        break;
      case "circle":
        if (assignment.circleId) circleIds.add(assignment.circleId);
        break;
      case "guardian_children":
        hasGuardianScope = true;
        break;
    }
  }

  return {
    hasAssociationScope,
    branchIds: [...branchIds],
    premiseIds: [...premiseIds],
    circleIds: [...circleIds],
    hasGuardianScope,
  };
}
