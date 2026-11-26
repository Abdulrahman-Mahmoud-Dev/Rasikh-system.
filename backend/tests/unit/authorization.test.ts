import { describe, expect, it } from "vitest";

import {
  canAssignRole,
  evaluatePermission,
  extractScopeSets,
  isGuardianOnly,
  type RoleAssignmentRecord,
} from "../../src/plugins/authorization.js";
import { ROLE_DEFAULT_PERMISSIONS } from "../../src/shared/domain/constants.js";

const ASSOC_A = "11111111-1111-4111-8111-111111111111";
const ASSOC_B = "22222222-2222-4222-8222-222222222222";
const BRANCH_1 = "33333333-3333-4333-8333-333333333333";
const BRANCH_2 = "44444444-4444-4444-8444-444444444444";
const PREMISE_1 = "55555555-5555-4555-8555-555555555555";
const CIRCLE_1 = "66666666-6666-4666-8666-666666666666";
const CIRCLE_2 = "77777777-7777-4777-8777-777777777777";
const STUDENT_1 = "88888888-8888-4888-8888-888888888888";

describe("Server-Side Authorization & Scope Enforcement (Constitution 1.5 Section 5)", () => {
  it("isolates permissions strictly per association and scope", () => {
    const branchManagerAssignments: RoleAssignmentRecord[] = [
      {
        id: "a1",
        associationId: ASSOC_A,
        membershipId: "m1",
        roleCode: "branch_manager",
        scopeType: "branch",
        branchId: BRANCH_1,
        quranicPremiseId: null,
        circleId: null,
        grantedPermissions: ROLE_DEFAULT_PERMISSIONS.branch_manager,
      },
    ];

    expect(
      evaluatePermission(branchManagerAssignments, "students:create", {
        associationId: ASSOC_A,
        branchId: BRANCH_1,
        quranicPremiseId: PREMISE_1,
        circleId: CIRCLE_1,
      }),
    ).toBe(true);

    // Denied on another branch inside same association
    expect(
      evaluatePermission(branchManagerAssignments, "students:create", {
        associationId: ASSOC_A,
        branchId: BRANCH_2,
      }),
    ).toBe(false);

    // Denied on another association
    expect(
      evaluatePermission(branchManagerAssignments, "students:create", {
        associationId: ASSOC_B,
        branchId: BRANCH_1,
      }),
    ).toBe(false);

    // Branch manager does NOT inherit association:manage
    expect(
      evaluatePermission(branchManagerAssignments, "association:manage", {
        associationId: ASSOC_A,
        branchId: BRANCH_1,
      }),
    ).toBe(false);
  });

  it("prevents supervisors or teachers from assigning equal/higher roles or escalating permissions", () => {
    const supervisorAssignments: RoleAssignmentRecord[] = [
      {
        id: "a2",
        associationId: ASSOC_A,
        membershipId: "m2",
        roleCode: "supervisor",
        scopeType: "quranic_premise",
        branchId: null,
        quranicPremiseId: PREMISE_1,
        circleId: null,
        grantedPermissions: ROLE_DEFAULT_PERMISSIONS.supervisor,
      },
    ];

    // Supervisor can assign a teacher with the teacher's default permissions.
    // The supervisor role includes the required plan, attendance, and recitation
    // permissions, but remains unable to assign equal or higher roles.
    expect(
      canAssignRole(
        supervisorAssignments,
        "teacher",
        ROLE_DEFAULT_PERMISSIONS.teacher,
      ),
    ).toBe(true);

    // Supervisor CAN assign teacher with the subset of permissions supervisor holds, or guardian
    expect(
      canAssignRole(supervisorAssignments, "teacher", [
        "students:read",
        "students:update",
        "reports:read",
      ]),
    ).toBe(true);

    // Supervisor CANNOT assign supervisor or branch_manager or association_manager
    expect(
      canAssignRole(supervisorAssignments, "supervisor", ["students:read"]),
    ).toBe(false);
    expect(
      canAssignRole(supervisorAssignments, "branch_manager", ["students:read"]),
    ).toBe(false);
    expect(
      canAssignRole(supervisorAssignments, "association_manager", [
        "association:manage",
      ]),
    ).toBe(false);

    // Teacher CANNOT grant association:manage to anyone
    const managerAssignments: RoleAssignmentRecord[] = [
      {
        id: "a3",
        associationId: ASSOC_A,
        membershipId: "m3",
        roleCode: "association_manager",
        scopeType: "association",
        branchId: null,
        quranicPremiseId: null,
        circleId: null,
        grantedPermissions: ROLE_DEFAULT_PERMISSIONS.association_manager,
      },
    ];

    expect(
      canAssignRole(managerAssignments, "teacher", ["association:manage"]),
    ).toBe(false);
    expect(
      canAssignRole(
        managerAssignments,
        "teacher",
        ROLE_DEFAULT_PERMISSIONS.teacher,
      ),
    ).toBe(true);
  });

  it("enforces guardian read-only limits and extracts exact scope filters", () => {
    const guardianAssignments: RoleAssignmentRecord[] = [
      {
        id: "g1",
        associationId: ASSOC_A,
        membershipId: "mg1",
        roleCode: "guardian",
        scopeType: "guardian_children",
        branchId: null,
        quranicPremiseId: null,
        circleId: null,
        grantedPermissions: ROLE_DEFAULT_PERMISSIONS.guardian,
      },
    ];

    expect(isGuardianOnly(guardianAssignments)).toBe(true);
    expect(
      evaluatePermission(guardianAssignments, "students:read", {
        associationId: ASSOC_A,
        guardianStudentId: STUDENT_1,
      }),
    ).toBe(true);
    expect(
      evaluatePermission(guardianAssignments, "students:update", {
        associationId: ASSOC_A,
        guardianStudentId: STUDENT_1,
      }),
    ).toBe(false);

    const teacherAssignments: RoleAssignmentRecord[] = [
      {
        id: "t1",
        associationId: ASSOC_A,
        membershipId: "mt1",
        roleCode: "teacher",
        scopeType: "circle",
        branchId: null,
        quranicPremiseId: null,
        circleId: CIRCLE_1,
        grantedPermissions: ROLE_DEFAULT_PERMISSIONS.teacher,
      },
      {
        id: "t2",
        associationId: ASSOC_A,
        membershipId: "mt1",
        roleCode: "teacher",
        scopeType: "circle",
        branchId: null,
        quranicPremiseId: null,
        circleId: CIRCLE_2,
        grantedPermissions: ROLE_DEFAULT_PERMISSIONS.teacher,
      },
    ];

    expect(isGuardianOnly(teacherAssignments)).toBe(false);
    const scopes = extractScopeSets(teacherAssignments, "students:read");
    expect(scopes.hasAssociationScope).toBe(false);
    expect(scopes.circleIds).toEqual([CIRCLE_1, CIRCLE_2]);
  });
});
