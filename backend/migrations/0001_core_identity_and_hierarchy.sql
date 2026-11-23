-- 0001: Core Identity & Organizational Hierarchy
-- Aligned with Rasikh Constitution 1.5 (Sections 1, 2, 4, 6).

CREATE TABLE public.associations (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  license_number text,
  license_verified boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'pending_deletion', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Branches are derived exclusively from geographic fields (no free-text name).
CREATE TABLE public.branches (
  id uuid PRIMARY KEY,
  association_id uuid NOT NULL,
  city text NOT NULL CHECK (length(btrim(city)) > 0),
  district text NOT NULL CHECK (length(btrim(district)) > 0),
  administrative_region text,
  display_name text GENERATED ALWAYS AS (
    CASE
      WHEN administrative_region IS NOT NULL AND length(btrim(administrative_region)) > 0
        THEN btrim(city) || '، ' || btrim(administrative_region) || '، ' || btrim(district)
      ELSE btrim(city) || '، ' || btrim(district)
    END
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT branches_association_fk
    FOREIGN KEY (association_id)
    REFERENCES public.associations (id)
    ON DELETE RESTRICT,

  CONSTRAINT branches_id_association_unique
    UNIQUE (id, association_id)
);

CREATE UNIQUE INDEX branches_association_geo_uidx
  ON public.branches (
    association_id,
    lower(btrim(city)),
    lower(btrim(district)),
    coalesce(lower(btrim(administrative_region)), '')
  );

-- Mosques and Qur'anic Centers share identical structure and rules.
CREATE TABLE public.quranic_premises (
  id uuid PRIMARY KEY,
  association_id uuid,
  branch_id uuid,
  premise_type text NOT NULL
    CHECK (premise_type IN ('mosque', 'quranic_center')),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  image_url text,
  affiliation_status text NOT NULL DEFAULT 'affiliated'
    CHECK (affiliation_status IN ('affiliated', 'independent', 'pending_join')),
  operational_status text NOT NULL DEFAULT 'pending_circle'
    CHECK (operational_status IN ('pending_circle', 'pending_supervisor', 'active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT quranic_premises_branch_fk
    FOREIGN KEY (branch_id, association_id)
    REFERENCES public.branches (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT quranic_premises_affiliation_scope_check
    CHECK (
      (affiliation_status = 'affiliated' AND association_id IS NOT NULL AND branch_id IS NOT NULL)
      OR
      (affiliation_status <> 'affiliated')
    ),

  CONSTRAINT quranic_premises_id_association_unique
    UNIQUE (id, association_id)
);

-- Circles belong to a mosque/center (never directly to a branch) and have no circle_type.
CREATE TABLE public.circles (
  id uuid PRIMARY KEY,
  association_id uuid NOT NULL,
  quranic_premise_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  study_period text NOT NULL
    CHECK (study_period IN ('after_fajr', 'after_dhuhr', 'after_asr', 'after_maghrib', 'after_isha')),
  target_stage text,
  operational_status text NOT NULL DEFAULT 'pending_teacher'
    CHECK (operational_status IN ('pending_teacher', 'active', 'paused', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT circles_quranic_premise_fk
    FOREIGN KEY (quranic_premise_id, association_id)
    REFERENCES public.quranic_premises (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT circles_id_association_unique
    UNIQUE (id, association_id)
);

-- Permanent registry ensuring file numbers (e.g. KRM-583921) are never recycled.
CREATE TABLE public.reserved_file_numbers (
  file_number text PRIMARY KEY
    CHECK (file_number ~ '^[A-Z]{3}-[0-9]{6}$'),
  reserved_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.persons (
  id uuid PRIMARY KEY,
  file_number text NOT NULL UNIQUE,
  full_name text NOT NULL CHECK (length(btrim(full_name)) > 0),
  phone text NOT NULL CHECK (phone ~ '^05[0-9]{8}$'),
  email text NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  avatar_url text,
  lifecycle_status text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active', 'archived', 'pending_deletion')),
  archived_at timestamptz,
  retention_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT persons_file_number_fk
    FOREIGN KEY (file_number)
    REFERENCES public.reserved_file_numbers (file_number)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX persons_email_lower_uidx
  ON public.persons (lower(btrim(email)));

CREATE UNIQUE INDEX persons_phone_uidx
  ON public.persons (phone);

CREATE INDEX branches_association_idx
  ON public.branches (association_id);

CREATE INDEX quranic_premises_branch_idx
  ON public.quranic_premises (association_id, branch_id);

CREATE INDEX circles_quranic_premise_idx
  ON public.circles (association_id, quranic_premise_id);

CREATE INDEX persons_lifecycle_idx
  ON public.persons (lifecycle_status, retention_expires_at)
  WHERE lifecycle_status <> 'active';
