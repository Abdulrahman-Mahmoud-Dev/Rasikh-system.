-- 0004: Teacher Guide Settings, Individual Education Plans, Daily Attendance, Recitations, Summaries & Sync Receipts
-- Aligned with Rasikh Constitution 1.5 (Section 7) and PostgreSQL Blueprint.

CREATE TABLE public.association_evaluation_settings (
  id uuid PRIMARY KEY,
  association_id uuid NOT NULL,
  memorization_weight numeric(5, 2) NOT NULL DEFAULT 40.00,
  review_weight numeric(5, 2) NOT NULL DEFAULT 30.00,
  attendance_weight numeric(5, 2) NOT NULL DEFAULT 30.00,
  excellent_multiplier numeric(3, 2) NOT NULL DEFAULT 1.00,
  very_good_multiplier numeric(3, 2) NOT NULL DEFAULT 0.85,
  good_multiplier numeric(3, 2) NOT NULL DEFAULT 0.70,
  acceptable_multiplier numeric(3, 2) NOT NULL DEFAULT 0.00,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT eval_settings_association_fk
    FOREIGN KEY (association_id)
    REFERENCES public.associations (id)
    ON DELETE RESTRICT,

  CONSTRAINT eval_settings_weights_sum_check
    CHECK (memorization_weight + review_weight + attendance_weight = 100.00),

  CONSTRAINT eval_settings_weights_non_negative_check
    CHECK (memorization_weight >= 0 AND review_weight >= 0 AND attendance_weight >= 0),

  CONSTRAINT eval_settings_id_association_unique
    UNIQUE (id, association_id)
);

CREATE UNIQUE INDEX eval_settings_one_active_per_association_uidx
  ON public.association_evaluation_settings (association_id)
  WHERE is_active = true;

-- Individual education plans per student (kept independent from daily logs).
CREATE TABLE public.education_plans (
  id uuid PRIMARY KEY,
  association_id uuid NOT NULL,
  student_id uuid NOT NULL,
  created_by_membership_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  target_memorization_pages numeric(7, 2) NOT NULL DEFAULT 0 CHECK (target_memorization_pages >= 0),
  target_review_pages numeric(7, 2) NOT NULL DEFAULT 0 CHECK (target_review_pages >= 0),
  target_study_days integer NOT NULL DEFAULT 20 CHECK (target_study_days > 0),
  hijri_start_date text NOT NULL CHECK (length(btrim(hijri_start_date)) > 0),
  hijri_end_date text NOT NULL CHECK (length(btrim(hijri_end_date)) > 0),
  weekly_distribution jsonb,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'archived')),
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT education_plans_student_fk
    FOREIGN KEY (student_id, association_id)
    REFERENCES public.students (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT education_plans_creator_fk
    FOREIGN KEY (created_by_membership_id, association_id)
    REFERENCES public.association_memberships (id, association_id)
    ON DELETE RESTRICT
);

CREATE TABLE public.daily_attendance_records (
  id uuid PRIMARY KEY,
  association_id uuid NOT NULL,
  student_id uuid NOT NULL,
  circle_id uuid NOT NULL,
  session_date date NOT NULL,
  hijri_period_key text NOT NULL CHECK (length(btrim(hijri_period_key)) > 0),
  status text NOT NULL
    CHECK (status IN ('present', 'absent', 'late', 'excused_absence', 'leave')),
  is_late_entry boolean NOT NULL DEFAULT false,
  recorded_by_membership_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT attendance_student_fk
    FOREIGN KEY (student_id, association_id)
    REFERENCES public.students (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT attendance_circle_fk
    FOREIGN KEY (circle_id, association_id)
    REFERENCES public.circles (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT attendance_recorder_fk
    FOREIGN KEY (recorded_by_membership_id, association_id)
    REFERENCES public.association_memberships (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT attendance_student_date_unique
    UNIQUE (association_id, student_id, session_date)
);

CREATE TABLE public.daily_recitation_records (
  id uuid PRIMARY KEY,
  association_id uuid NOT NULL,
  student_id uuid NOT NULL,
  circle_id uuid NOT NULL,
  session_date date NOT NULL,
  hijri_period_key text NOT NULL CHECK (length(btrim(hijri_period_key)) > 0),
  track text NOT NULL
    CHECK (track IN ('new_memorization', 'minor_review', 'major_review')),
  from_surah smallint NOT NULL CHECK (from_surah BETWEEN 1 AND 114),
  from_ayah integer NOT NULL CHECK (from_ayah >= 1),
  to_surah smallint NOT NULL CHECK (to_surah BETWEEN 1 AND 114),
  to_ayah integer NOT NULL CHECK (to_ayah >= 1),
  pages_count numeric(5, 2) NOT NULL CHECK (pages_count >= 0),
  daily_rating text NOT NULL
    CHECK (daily_rating IN ('excellent', 'very_good', 'good', 'acceptable', 'retry', 'not_recited')),
  quality_multiplier numeric(3, 2) NOT NULL
    CHECK (quality_multiplier IN (1.00, 0.85, 0.70, 0.00)),
  score_out_of_10 numeric(4, 2) NOT NULL CHECK (score_out_of_10 >= 0 AND score_out_of_10 <= 10),
  tajweed_errors integer NOT NULL DEFAULT 0 CHECK (tajweed_errors >= 0),
  reading_errors integer NOT NULL DEFAULT 0 CHECK (reading_errors >= 0),
  teacher_note text,
  is_late_entry boolean NOT NULL DEFAULT false,
  recorded_by_membership_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT recitation_student_fk
    FOREIGN KEY (student_id, association_id)
    REFERENCES public.students (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT recitation_circle_fk
    FOREIGN KEY (circle_id, association_id)
    REFERENCES public.circles (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT recitation_recorder_fk
    FOREIGN KEY (recorded_by_membership_id, association_id)
    REFERENCES public.association_memberships (id, association_id)
    ON DELETE RESTRICT
);

-- Stores periodic summaries linked to the exact evaluation_settings_id snapshot used.
CREATE TABLE public.monthly_student_summaries (
  id uuid PRIMARY KEY,
  association_id uuid NOT NULL,
  student_id uuid NOT NULL,
  hijri_period_key text NOT NULL CHECK (length(btrim(hijri_period_key)) > 0),
  evaluation_settings_id uuid NOT NULL,
  attended_days integer NOT NULL DEFAULT 0 CHECK (attended_days >= 0),
  study_days integer NOT NULL DEFAULT 20 CHECK (study_days > 0),
  unrecorded_days integer NOT NULL DEFAULT 0 CHECK (unrecorded_days >= 0),
  adjusted_mem_pages numeric(7, 2) NOT NULL DEFAULT 0 CHECK (adjusted_mem_pages >= 0),
  adjusted_review_pages numeric(7, 2) NOT NULL DEFAULT 0 CHECK (adjusted_review_pages >= 0),
  final_percentage numeric(5, 2) NOT NULL DEFAULT 0 CHECK (final_percentage >= 0 AND final_percentage <= 100),
  general_grade text NOT NULL
    CHECK (general_grade IN ('excellent', 'high_very_good', 'very_good', 'acceptable_retry')),
  monthly_badge text NOT NULL
    CHECK (monthly_badge IN ('ideal_student', 'regular_distinguished', 'diligent_achiever', 'needs_regularity')),
  computed_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT monthly_summaries_student_fk
    FOREIGN KEY (student_id, association_id)
    REFERENCES public.students (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT monthly_summaries_settings_fk
    FOREIGN KEY (evaluation_settings_id, association_id)
    REFERENCES public.association_evaluation_settings (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT monthly_summaries_period_unique
    UNIQUE (association_id, student_id, hijri_period_key)
);

-- Stores only the idempotency receipt hash and outcome (no PII payload).
CREATE TABLE public.sync_operation_receipts (
  id uuid PRIMARY KEY,
  association_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  account_id uuid NOT NULL,
  person_id uuid NOT NULL,
  device_instance_id uuid NOT NULL,
  client_operation_id uuid NOT NULL,
  operation_type text NOT NULL
    CHECK (operation_type IN ('attendance.record', 'recitation.record')),
  payload_sha256 char(64) NOT NULL
    CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  outcome text NOT NULL
    CHECK (outcome IN ('accepted', 'conflict', 'rejected')),
  result_code text,
  client_created_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sync_receipts_membership_fk
    FOREIGN KEY (membership_id, association_id, person_id)
    REFERENCES public.association_memberships (id, association_id, person_id)
    ON DELETE RESTRICT,

  CONSTRAINT sync_receipts_account_fk
    FOREIGN KEY (account_id, person_id)
    REFERENCES public.user_accounts (id, person_id)
    ON DELETE RESTRICT,

  CONSTRAINT sync_receipts_operation_unique
    UNIQUE (association_id, client_operation_id),

  CONSTRAINT sync_receipts_result_code_check
    CHECK (
      (outcome = 'accepted' AND result_code IS NULL)
      OR
      (outcome IN ('conflict', 'rejected') AND result_code IS NOT NULL)
    )
);

CREATE INDEX education_plans_student_idx
  ON public.education_plans (association_id, student_id, status);

CREATE INDEX attendance_period_idx
  ON public.daily_attendance_records (association_id, hijri_period_key, circle_id);

CREATE INDEX recitation_period_idx
  ON public.daily_recitation_records (association_id, hijri_period_key, student_id);

CREATE INDEX monthly_summaries_period_idx
  ON public.monthly_student_summaries (association_id, hijri_period_key);

CREATE INDEX sync_receipts_membership_received_idx
  ON public.sync_operation_receipts (association_id, membership_id, received_at DESC);
