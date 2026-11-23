-- 0003: Students, Guardian Links (Max 2), Single Active Enrollment, Transfers, Approval Requests & Append-Only Audit Log
-- Aligned with Rasikh Constitution 1.5 (Sections 4.4, 5, 6, 8.3, 8.4).

CREATE TABLE public.students (
  id uuid PRIMARY KEY,
  association_id uuid NOT NULL,
  person_id uuid NOT NULL,
  educational_status text NOT NULL DEFAULT 'active'
    CHECK (educational_status IN ('active', 'temporarily_suspended', 'expelled')),
  previous_memorized_juz numeric(4, 2) NOT NULL DEFAULT 0
    CHECK (previous_memorized_juz >= 0 AND previous_memorized_juz <= 30),
  special_circumstance_note text,
  special_circumstance_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT students_person_fk
    FOREIGN KEY (person_id)
    REFERENCES public.persons (id)
    ON DELETE RESTRICT,

  CONSTRAINT students_association_fk
    FOREIGN KEY (association_id)
    REFERENCES public.associations (id)
    ON DELETE RESTRICT,

  CONSTRAINT students_person_association_unique
    UNIQUE (association_id, person_id),

  CONSTRAINT students_id_association_unique
    UNIQUE (id, association_id)
);

ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_target_student_fk
  FOREIGN KEY (target_student_id, association_id)
  REFERENCES public.students (id, association_id)
  ON DELETE RESTRICT;

CREATE TABLE public.guardian_student_links (
  id uuid PRIMARY KEY,
  association_id uuid NOT NULL,
  guardian_membership_id uuid NOT NULL,
  student_id uuid NOT NULL,
  relationship_label text NOT NULL
    CHECK (length(btrim(relationship_label)) BETWEEN 1 AND 64),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT guardian_student_membership_fk
    FOREIGN KEY (guardian_membership_id, association_id)
    REFERENCES public.association_memberships (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT guardian_student_student_fk
    FOREIGN KEY (student_id, association_id)
    REFERENCES public.students (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT guardian_student_validity_check
    CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE UNIQUE INDEX guardian_student_active_pair_uidx
  ON public.guardian_student_links (association_id, guardian_membership_id, student_id)
  WHERE valid_until IS NULL;

-- Enforce Rasikh Constitution 1.5 Section 4.4: Maximum 2 active guardians per student.
CREATE OR REPLACE FUNCTION public.enforce_max_two_active_guardians()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_count integer;
BEGIN
  IF NEW.valid_until IS NOT NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM public.students
  WHERE id = NEW.student_id AND association_id = NEW.association_id
  FOR UPDATE;

  SELECT COUNT(*)
  INTO active_count
  FROM public.guardian_student_links
  WHERE association_id = NEW.association_id
    AND student_id = NEW.student_id
    AND valid_until IS NULL
    AND id <> NEW.id;

  IF active_count >= 2 THEN
    RAISE EXCEPTION 'Student cannot have more than 2 active guardian links'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guardian_student_max_two_trigger
  BEFORE INSERT OR UPDATE ON public.guardian_student_links
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_max_two_active_guardians();

CREATE TABLE public.student_circle_enrollments (
  id uuid PRIMARY KEY,
  association_id uuid NOT NULL,
  student_id uuid NOT NULL,
  circle_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  recorded_by_membership_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT student_enrollment_student_fk
    FOREIGN KEY (student_id, association_id)
    REFERENCES public.students (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT student_enrollment_circle_fk
    FOREIGN KEY (circle_id, association_id)
    REFERENCES public.circles (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT student_enrollment_recorder_fk
    FOREIGN KEY (recorded_by_membership_id, association_id)
    REFERENCES public.association_memberships (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT student_enrollment_validity_check
    CHECK (ended_at IS NULL OR ended_at > started_at)
);

-- Enforce Constitution Section 6.1: A student can be actively enrolled in at most one circle per association.
CREATE UNIQUE INDEX student_one_active_circle_per_association_uidx
  ON public.student_circle_enrollments (association_id, student_id)
  WHERE ended_at IS NULL;

CREATE TABLE public.student_transfers (
  id uuid PRIMARY KEY,
  association_id uuid NOT NULL,
  student_id uuid NOT NULL,
  from_circle_id uuid NOT NULL,
  to_circle_id uuid NOT NULL,
  requested_by_membership_id uuid NOT NULL,
  supervisor_approved_by_membership_id uuid,
  receiving_teacher_accepted_by_membership_id uuid,
  status text NOT NULL DEFAULT 'pending_supervisor'
    CHECK (status IN ('pending_supervisor', 'pending_teacher', 'approved', 'rejected', 'cancelled')),
  reason text,
  decision_reason text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT student_transfers_student_fk
    FOREIGN KEY (student_id, association_id)
    REFERENCES public.students (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT student_transfers_from_circle_fk
    FOREIGN KEY (from_circle_id, association_id)
    REFERENCES public.circles (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT student_transfers_to_circle_fk
    FOREIGN KEY (to_circle_id, association_id)
    REFERENCES public.circles (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT student_transfers_requester_fk
    FOREIGN KEY (requested_by_membership_id, association_id)
    REFERENCES public.association_memberships (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT student_transfers_supervisor_fk
    FOREIGN KEY (supervisor_approved_by_membership_id, association_id)
    REFERENCES public.association_memberships (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT student_transfers_teacher_fk
    FOREIGN KEY (receiving_teacher_accepted_by_membership_id, association_id)
    REFERENCES public.association_memberships (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT student_transfers_different_circles_check
    CHECK (from_circle_id <> to_circle_id)
);

CREATE TABLE public.approval_requests (
  id uuid PRIMARY KEY,
  association_id uuid NOT NULL,
  request_type text NOT NULL
    CHECK (request_type IN ('promotion_request', 'responsibility_handover', 'association_deletion', 'student_transfer')),
  requester_membership_id uuid NOT NULL,
  target_role_code text,
  replacement_membership_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  justification text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decision_reason text,
  decided_by_membership_id uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT approval_requests_association_fk
    FOREIGN KEY (association_id)
    REFERENCES public.associations (id)
    ON DELETE RESTRICT,

  CONSTRAINT approval_requests_requester_fk
    FOREIGN KEY (requester_membership_id, association_id)
    REFERENCES public.association_memberships (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT approval_requests_replacement_fk
    FOREIGN KEY (replacement_membership_id, association_id)
    REFERENCES public.association_memberships (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT approval_requests_decider_fk
    FOREIGN KEY (decided_by_membership_id, association_id)
    REFERENCES public.association_memberships (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT approval_requests_id_association_unique
    UNIQUE (id, association_id)
);

CREATE TABLE public.approval_request_votes (
  id uuid PRIMARY KEY,
  association_id uuid NOT NULL,
  request_id uuid NOT NULL,
  voter_membership_id uuid NOT NULL,
  voter_role_code text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason text,
  voted_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT approval_votes_request_fk
    FOREIGN KEY (request_id, association_id)
    REFERENCES public.approval_requests (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT approval_votes_voter_fk
    FOREIGN KEY (voter_membership_id, association_id)
    REFERENCES public.association_memberships (id, association_id)
    ON DELETE RESTRICT,

  CONSTRAINT approval_votes_unique_voter
    UNIQUE (request_id, voter_membership_id)
);

-- Append-only audit events log (Constitution 1.5 Section 8.4).
CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY,
  association_id uuid,
  actor_person_id uuid,
  actor_membership_id uuid,
  event_type text NOT NULL CHECK (length(btrim(event_type)) > 0),
  entity_type text NOT NULL CHECK (length(btrim(entity_type)) > 0),
  entity_id uuid,
  previous_data jsonb,
  new_data jsonb,
  reason text,
  corrects_event_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT audit_events_association_fk
    FOREIGN KEY (association_id)
    REFERENCES public.associations (id)
    ON DELETE RESTRICT,

  CONSTRAINT audit_events_actor_person_fk
    FOREIGN KEY (actor_person_id)
    REFERENCES public.persons (id)
    ON DELETE RESTRICT,

  CONSTRAINT audit_events_corrects_fk
    FOREIGN KEY (corrects_event_id)
    REFERENCES public.audit_events (id)
    ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only; insert a corrective event instead'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_events_immutable_trigger
  BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_audit_event_mutation();

CREATE INDEX students_association_status_idx
  ON public.students (association_id, educational_status);

CREATE INDEX guardian_student_student_idx
  ON public.guardian_student_links (association_id, student_id);

CREATE INDEX guardian_student_membership_idx
  ON public.guardian_student_links (association_id, guardian_membership_id);

CREATE INDEX student_enrollments_student_history_idx
  ON public.student_circle_enrollments (association_id, student_id, started_at DESC);

CREATE INDEX student_enrollments_circle_history_idx
  ON public.student_circle_enrollments (association_id, circle_id, started_at DESC);

CREATE INDEX student_transfers_association_status_idx
  ON public.student_transfers (association_id, status, created_at DESC);

CREATE INDEX approval_requests_association_status_idx
  ON public.approval_requests (association_id, status, created_at DESC);

CREATE INDEX audit_events_association_time_idx
  ON public.audit_events (association_id, occurred_at DESC);
