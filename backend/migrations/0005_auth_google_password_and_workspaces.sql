-- 0005: Password / Google authentication, email links, and workspace onboarding.
-- Adds account-level capabilities without removing the existing identity model.

-- An account can be created before the owner adds a phone number.
-- Existing person and student records remain available; their UI validation is
-- intentionally unchanged by this migration.
ALTER TABLE public.persons
  ALTER COLUMN phone DROP NOT NULL;

-- Manual-password accounts store only a derived password hash (never plaintext).
-- Google-only accounts may leave password_hash NULL.
ALTER TABLE public.user_accounts
  ADD COLUMN password_hash text;

-- Google provider identity is matched using the stable Google "sub" claim,
-- not email, so email changes do not create duplicate identities.
CREATE TABLE public.auth_identities (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  person_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('google')),
  provider_subject text NOT NULL CHECK (length(btrim(provider_subject)) > 0),
  provider_email text NOT NULL
    CHECK (provider_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,

  CONSTRAINT auth_identities_account_fk
    FOREIGN KEY (account_id, person_id)
    REFERENCES public.user_accounts (id, person_id)
    ON DELETE RESTRICT,

  CONSTRAINT auth_identities_provider_subject_unique
    UNIQUE (provider, provider_subject),

  CONSTRAINT auth_identities_account_provider_unique
    UNIQUE (account_id, provider)
);

-- Single-use email verification and password recovery links.
-- Only a keyed token digest is stored; the raw token is sent by email.
CREATE TABLE public.account_email_tokens (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  person_id uuid NOT NULL,
  purpose text NOT NULL
    CHECK (purpose IN ('email_verification', 'password_reset')),
  token_hash char(64) NOT NULL UNIQUE
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT account_email_tokens_account_fk
    FOREIGN KEY (account_id, person_id)
    REFERENCES public.user_accounts (id, person_id)
    ON DELETE RESTRICT,

  CONSTRAINT account_email_tokens_expiry_check
    CHECK (expires_at > created_at)
);

CREATE INDEX account_email_tokens_lookup_idx
  ON public.account_email_tokens (account_id, purpose, expires_at DESC)
  WHERE consumed_at IS NULL;

-- One-use nonce values bind a Google ID token to a browser sign-in attempt.
CREATE TABLE public.auth_nonce_challenges (
  id uuid PRIMARY KEY,
  nonce_hash char(64) NOT NULL UNIQUE
    CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT auth_nonce_challenges_expiry_check
    CHECK (expires_at > created_at)
);

CREATE INDEX auth_nonce_challenges_expiry_idx
  ON public.auth_nonce_challenges (expires_at)
  WHERE consumed_at IS NULL;

-- Registered associations and independent/demo workspaces share the tenant-safe
-- organizational model, but their lifecycle and onboarding rules are distinct.
ALTER TABLE public.associations
  ADD COLUMN workspace_kind text NOT NULL DEFAULT 'registered_association'
    CHECK (
      workspace_kind IN (
        'registered_association',
        'independent_mosque',
        'independent_quranic_center',
        'demo'
      )
    );

ALTER TABLE public.associations
  DROP CONSTRAINT IF EXISTS associations_status_check;

ALTER TABLE public.associations
  ADD CONSTRAINT associations_status_check
    CHECK (
      status IN (
        'active',
        'pending_verification',
        'suspended',
        'pending_deletion',
        'archived'
      )
    );

-- License details are submitted first. The association must remain pending until
-- an official verification integration or authorized human review confirms them.
CREATE TABLE public.association_registration_requests (
  id uuid PRIMARY KEY,
  association_id uuid NOT NULL UNIQUE,
  applicant_person_id uuid NOT NULL,
  license_number text NOT NULL CHECK (length(btrim(license_number)) > 0),
  licensing_authority text NOT NULL
    CHECK (length(btrim(licensing_authority)) > 0),
  status text NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'verified', 'rejected')),
  verification_method text NOT NULL DEFAULT 'manual_review'
    CHECK (verification_method IN ('official_api', 'manual_review')),
  verification_reference text,
  decision_reason text,
  reviewed_by_person_id uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT association_registration_association_fk
    FOREIGN KEY (association_id)
    REFERENCES public.associations (id)
    ON DELETE RESTRICT,

  CONSTRAINT association_registration_applicant_fk
    FOREIGN KEY (applicant_person_id)
    REFERENCES public.persons (id)
    ON DELETE RESTRICT,

  CONSTRAINT association_registration_reviewer_fk
    FOREIGN KEY (reviewed_by_person_id)
    REFERENCES public.persons (id)
    ON DELETE RESTRICT
);

CREATE INDEX association_registration_status_idx
  ON public.association_registration_requests (status, created_at DESC);
