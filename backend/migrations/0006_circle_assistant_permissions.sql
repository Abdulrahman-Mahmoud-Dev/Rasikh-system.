-- 0006: Circle assistant role and explicit record/evaluation permissions.
-- The assistant is a scoped operational role, not a supervisor or teacher.

ALTER TABLE public.role_assignments
  DROP CONSTRAINT IF EXISTS role_assignments_role_code_check;

ALTER TABLE public.role_assignments
  ADD CONSTRAINT role_assignments_role_code_check
    CHECK (
      role_code IN (
        'association_manager',
        'association_deputy',
        'branch_manager',
        'branch_deputy',
        'supervisor',
        'supervisor_deputy',
        'teacher',
        'circle_assistant',
        'guardian'
      )
    );

ALTER TABLE public.invitations
  DROP CONSTRAINT IF EXISTS invitations_role_code_check;

ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_role_code_check
    CHECK (
      role_code IN (
        'association_manager',
        'association_deputy',
        'branch_manager',
        'branch_deputy',
        'supervisor',
        'supervisor_deputy',
        'teacher',
        'circle_assistant',
        'guardian'
      )
    );
