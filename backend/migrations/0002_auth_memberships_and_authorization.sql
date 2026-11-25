-- 0002: Accounts, Authentication Challenges, Sessions, Memberships, Scoped Roles & Invitations
-- Aligned with Rasikh Constitution 1.5 (Sections 3, 4, 5, 23).

CREATE TABLE public.user_accounts (
  id uuid PRIMARY KEY,
  person_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'disabled')),
  platform_role text
    CHECK (platform_role IS NULL OR platform_role IN ('platform_admin', 'platform_deputy')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_accounts_person_fk
    FOREIGN KEY (person_id)
    REFERENCES public.persons (id)
    ON DELETE RESTRICT,

  CONSTRAINT user_accounts_id_person_unique
    UNIQUE (id, person_id)
);

-- Server-side OTP challenges (stored strictly as HMAC-SHA256 hashes, never plaintext).
CREATE TABLE public.login_challenges (
  id uuid PRIMARY KEY,
  identifier_type text NOT NULL
    CHECK (identifier_type IN ('email', 'phone')),
  identifier_value text NOT NULL CHECK (length(btrim(identifier_value)) > 0),
  channel text NOT NULL
    CHECK (channel IN ('email', 'phone')),
  otp_hash char(64) NOT NULL
    CHECK (otp_hash ~ '^[0-9a-f]{64}$'),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT login_challenges_expiry_check
    CHECK (expires_at > created_at)
);

-- HttpOnly cookie sessions stored as HMAC-SHA256 token hashes.
CREATE TABLE public.auth_sessions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  person_id uuid NOT NULL,
  token_hash char(64) NOT NULL UNIQUE
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_agent text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT auth_sessions_account_fk
    FOREIGN KEY (account_id, person_id)
    REFERENCES public.user_accounts (id, person_id)
    ON DELETE RESTRICT,

  CONSTRAINT auth_sessions_expiry_check
    CHECK (expires_at > created_at)
);

-- Separates a person's unified identity from their membership in each association.
CREATE TABLE public.association_memberships (
  id uuid PRIMARY KEY,
  association_id uuid NOT NULL,
  person_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended', 'revoked', 'ended')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT memberships_association_fk
    FOREIGN KEY (association_id)
    REFERENCES public.associations (id)
    ON DELETE RESTRICT,

  CONSTRAINT memberships_person_fk
    FOREIGN KEY (person_id)
    REFERENCES public.persons (id)
    ON DELETE RESTRICT,

  CONSTRAINT memberships_person_association_unique
    UNIQUE (association_id, person_id),

  CONSTRAINT memberships_id_association_unique
    UNIQUE (id, association_id),

  CONSTRAINT memberships_id_association_person_unique
    UNIQUE (id, association_id, person_id),

  CONSTRAINT memberships_validity_check
    CHECK (valid_until IS NULL OR valid_until > valid_from)
);

-- Role assignments are scoped and explicitly list granted permissions (no mosque_manager role).
CREATE TABLE public.role_assignments (
  id uuid PRIMARY KEY,
  association_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  role_code text NOT NULL
    CHECK (
      role_code IN (
        'association_manager',
        'association_deputy',
        'branch_manager',
        'branch_deputy',
        'supervisor',
        'supervisor_deputy',
        'teacher',
        'guardian'
      )
    ),
  scope_type text NOT NULL
    CHECK (scope_type IN ('association', 'branch', 'quranic_premise', 'circle', 'guardian_children')),
  branch_id uuid,
  quranic_premise_id uuid,
  circle_id uuid,
  granted_permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_primary_mandatory boolean NOT NULL DEFAULT false,
  replaced_by_assignment_id uuid,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT role_assignments_membership_fk
    FOREIGN KEY (membership_id, association_id)
    REFERENCES public.association_memberships (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT role_assignments_branch_scope_fk
    FOREIGN KEY (branch_id, association_id)
    REFERENCES public.branches (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT role_assignments_premise_scope_fk
    FOREIGN KEY (quranic_premise_id, association_id)
    REFERENCES public.quranic_premises (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT role_assignments_circle_scope_fk
    FOREIGN KEY (circle_id, association_id)
    REFERENCES public.circles (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT role_assignments_replacement_fk
    FOREIGN KEY (replaced_by_assignment_id)
    REFERENCES public.role_assignments (id)
    ON DELETE RESTRICT,

  CONSTRAINT role_assignments_scope_shape_check
    CHECK (
      (scope_type IN ('association', 'guardian_children')
        AND branch_id IS NULL
        AND quranic_premise_id IS NULL
        AND circle_id IS NULL)
      OR
      (scope_type = 'branch'
        AND branch_id IS NOT NULL
        AND quranic_premise_id IS NULL
        AND circle_id IS NULL)
      OR
      (scope_type = 'quranic_premise'
        AND branch_id IS NULL
        AND quranic_premise_id IS NOT NULL
        AND circle_id IS NULL)
      OR
      (scope_type = 'circle'
        AND branch_id IS NULL
        AND quranic_premise_id IS NULL
        AND circle_id IS NOT NULL)
    ),

  CONSTRAINT role_assignments_permissions_array_check
    CHECK (jsonb_typeof(granted_permissions) = 'array'),

  CONSTRAINT role_assignments_validity_check
    CHECK (valid_until IS NULL OR valid_until > valid_from)
);

-- Invitations are single-use, scoped, and hashed before storage.
CREATE TABLE public.invitations (
  id uuid PRIMARY KEY,
  association_id uuid NOT NULL,
  invite_type text NOT NULL
    CHECK (invite_type IN ('staff_role', 'guardian_link')),
  recipient_email text
    CHECK (recipient_email IS NULL OR recipient_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  recipient_phone text
    CHECK (recipient_phone IS NULL OR recipient_phone ~ '^05[0-9]{8}$'),
  token_hash char(64) NOT NULL UNIQUE
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  role_code text NOT NULL
    CHECK (
      role_code IN (
        'association_manager',
        'association_deputy',
        'branch_manager',
        'branch_deputy',
        'supervisor',
        'supervisor_deputy',
        'teacher',
        'guardian'
      )
    ),
  scope_type text NOT NULL
    CHECK (scope_type IN ('association', 'branch', 'quranic_premise', 'circle', 'guardian_children')),
  branch_id uuid,
  quranic_premise_id uuid,
  circle_id uuid,
  target_student_id uuid,
  relationship_label text,
  granted_permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  invited_by_person_id uuid NOT NULL,
  accepted_by_person_id uuid,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invitations_association_fk
    FOREIGN KEY (association_id)
    REFERENCES public.associations (id)
    ON DELETE RESTRICT,

  CONSTRAINT invitations_branch_scope_fk
    FOREIGN KEY (branch_id, association_id)
    REFERENCES public.branches (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT invitations_premise_scope_fk
    FOREIGN KEY (quranic_premise_id, association_id)
    REFERENCES public.quranic_premises (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT invitations_circle_scope_fk
    FOREIGN KEY (circle_id, association_id)
    REFERENCES public.circles (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT invitations_invited_by_fk
    FOREIGN KEY (invited_by_person_id)
    REFERENCES public.persons (id)
    ON DELETE RESTRICT,

  CONSTRAINT invitations_accepted_by_fk
    FOREIGN KEY (accepted_by_person_id)
    REFERENCES public.persons (id)
    ON DELETE RESTRICT,

  CONSTRAINT invitations_recipient_check
    CHECK (recipient_email IS NOT NULL OR recipient_phone IS NOT NULL),

  CONSTRAINT invitations_permissions_array_check
    CHECK (jsonb_typeof(granted_permissions) = 'array')
);

CREATE INDEX login_challenges_lookup_idx
  ON public.login_challenges (identifier_type, identifier_value, created_at DESC);

CREATE INDEX auth_sessions_person_active_idx
  ON public.auth_sessions (person_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX memberships_person_idx
  ON public.association_memberships (person_id, status);

CREATE INDEX role_assignments_membership_idx
  ON public.role_assignments (association_id, membership_id, valid_until);

CREATE INDEX role_assignments_branch_scope_idx
  ON public.role_assignments (association_id, branch_id)
  WHERE branch_id IS NOT NULL;

CREATE INDEX role_assignments_premise_scope_idx
  ON public.role_assignments (association_id, quranic_premise_id)
  WHERE quranic_premise_id IS NOT NULL;

CREATE INDEX role_assignments_circle_scope_idx
  ON public.role_assignments (association_id, circle_id)
  WHERE circle_id IS NOT NULL;

CREATE INDEX invitations_association_status_idx
  ON public.invitations (association_id, status, expires_at);
