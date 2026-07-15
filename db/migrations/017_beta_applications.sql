-- Minimal-PII, deployment-global private-beta applications. The public native
-- form persists only the allowlisted contact/workflow fields below. Network
-- addresses, user agents, request headers, free-form family details, provider
-- response bodies, and provider credentials never belong in this table.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE public.beta_applications (
  id uuid PRIMARY KEY,
  submission_day date NOT NULL,
  submission_digest text NOT NULL CHECK (submission_digest ~ '^[a-f0-9]{64}$'),
  email_digest text NOT NULL CHECK (email_digest ~ '^[a-f0-9]{64}$'),
  name text NOT NULL CHECK (
    length(name) BETWEEN 1 AND 100
    AND name = btrim(name)
    AND name !~ '[[:cntrl:]]'
  ),
  email text NOT NULL CHECK (
    length(email) BETWEEN 3 AND 254
    AND email = lower(btrim(email))
    AND email !~ '[[:cntrl:][:space:]]'
    AND email LIKE '%@%'
  ),
  researcher_type text NOT NULL CHECK (researcher_type IN (
    'family-historian', 'professional-genealogist', 'society-member',
    'developer-self-hoster', 'other-researcher'
  )),
  workflow text NOT NULL CHECK (workflow IN (
    'gedcom-review', 'source-research', 'research-cases',
    'deterministic-quality', 'developer-api'
  )),
  archive_size_band text NOT NULL CHECK (archive_size_band IN (
    'prefer-not-to-say', 'under-1000', '1000-10000', '10000-50000', 'over-50000'
  )),
  current_tool text CHECK (current_tool IS NULL OR current_tool IN (
    'ancestry', 'family-tree-maker', 'rootsmagic', 'gramps',
    'familysearch', 'legacy-family-tree', 'other'
  )),
  consent_version text NOT NULL CHECK (consent_version = 'beta-communications-v1'),
  consented_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (
    state IN ('pending', 'reviewing', 'invited', 'declined', 'withdrawn')
  ),
  applicant_delivery_state text NOT NULL DEFAULT 'pending' CHECK (
    applicant_delivery_state IN ('pending', 'sent')
  ),
  applicant_delivery_provider text CHECK (
    applicant_delivery_provider IS NULL OR applicant_delivery_provider = 'resend'
  ),
  applicant_delivery_message_digest text CHECK (
    applicant_delivery_message_digest IS NULL
    OR applicant_delivery_message_digest ~ '^[a-f0-9]{64}$'
  ),
  applicant_delivered_at timestamptz,
  founder_delivery_state text NOT NULL DEFAULT 'pending' CHECK (
    founder_delivery_state IN ('pending', 'sent')
  ),
  founder_delivery_provider text CHECK (
    founder_delivery_provider IS NULL OR founder_delivery_provider = 'resend'
  ),
  founder_delivery_message_digest text CHECK (
    founder_delivery_message_digest IS NULL
    OR founder_delivery_message_digest ~ '^[a-f0-9]{64}$'
  ),
  founder_delivered_at timestamptz,
  delivery_attempt_count integer NOT NULL DEFAULT 0 CHECK (
    delivery_attempt_count BETWEEN 0 AND 100
  ),
  last_delivery_attempt_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  retention_expires_at timestamptz NOT NULL,
  UNIQUE (submission_day, submission_digest),
  CHECK (submission_day = (created_at AT TIME ZONE 'UTC')::date),
  CHECK (consented_at = created_at),
  CHECK (updated_at >= created_at),
  CHECK (retention_expires_at = created_at + interval '90 days'),
  CHECK (
    (delivery_attempt_count = 0 AND last_delivery_attempt_at IS NULL)
    OR (delivery_attempt_count > 0 AND last_delivery_attempt_at >= created_at)
  ),
  CHECK (
    (applicant_delivery_state = 'pending'
      AND applicant_delivery_provider IS NULL
      AND applicant_delivery_message_digest IS NULL
      AND applicant_delivered_at IS NULL)
    OR (applicant_delivery_state = 'sent'
      AND applicant_delivery_provider IS NOT NULL
      AND applicant_delivery_message_digest IS NOT NULL
      AND applicant_delivered_at >= created_at)
  ),
  CHECK (
    (founder_delivery_state = 'pending'
      AND founder_delivery_provider IS NULL
      AND founder_delivery_message_digest IS NULL
      AND founder_delivered_at IS NULL)
    OR (founder_delivery_state = 'sent'
      AND founder_delivery_provider IS NOT NULL
      AND founder_delivery_message_digest IS NOT NULL
      AND founder_delivered_at >= created_at)
  )
);

CREATE INDEX beta_applications_email_time_idx
  ON public.beta_applications (email_digest, created_at DESC, id);

CREATE INDEX beta_applications_review_idx
  ON public.beta_applications (state, created_at, id);

CREATE INDEX beta_applications_retention_idx
  ON public.beta_applications (retention_expires_at, id);

-- Submitted contact/workflow and consent identity are immutable. Delivery may
-- only advance from pending to sent, and a successful provider receipt cannot
-- be rewritten or rolled back. Retention and explicit DSAR deletion remain the
-- only supported DELETE paths.
CREATE FUNCTION public.beta_protect_application_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.id, NEW.submission_day, NEW.submission_digest, NEW.email_digest,
    NEW.name, NEW.email, NEW.researcher_type, NEW.workflow,
    NEW.archive_size_band, NEW.current_tool, NEW.consent_version,
    NEW.consented_at, NEW.created_at, NEW.retention_expires_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.submission_day, OLD.submission_digest, OLD.email_digest,
    OLD.name, OLD.email, OLD.researcher_type, OLD.workflow,
    OLD.archive_size_band, OLD.current_tool, OLD.consent_version,
    OLD.consented_at, OLD.created_at, OLD.retention_expires_at
  ) THEN
    RAISE EXCEPTION 'beta application identity and consent are immutable';
  END IF;
  IF OLD.applicant_delivery_state = 'sent' AND ROW(
    NEW.applicant_delivery_state, NEW.applicant_delivery_provider,
    NEW.applicant_delivery_message_digest, NEW.applicant_delivered_at
  ) IS DISTINCT FROM ROW(
    OLD.applicant_delivery_state, OLD.applicant_delivery_provider,
    OLD.applicant_delivery_message_digest, OLD.applicant_delivered_at
  ) THEN
    RAISE EXCEPTION 'beta application receipt delivery is immutable';
  END IF;
  IF OLD.founder_delivery_state = 'sent' AND ROW(
    NEW.founder_delivery_state, NEW.founder_delivery_provider,
    NEW.founder_delivery_message_digest, NEW.founder_delivered_at
  ) IS DISTINCT FROM ROW(
    OLD.founder_delivery_state, OLD.founder_delivery_provider,
    OLD.founder_delivery_message_digest, OLD.founder_delivered_at
  ) THEN
    RAISE EXCEPTION 'beta application founder delivery is immutable';
  END IF;
  IF NEW.delivery_attempt_count < OLD.delivery_attempt_count
     OR NEW.last_delivery_attempt_at < OLD.last_delivery_attempt_at
     OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'beta application delivery time cannot move backward';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER beta_applications_protected_transition
  BEFORE UPDATE ON public.beta_applications
  FOR EACH ROW EXECUTE FUNCTION public.beta_protect_application_transition();

ALTER TABLE public.beta_applications ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.beta_applications FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.beta_protect_application_transition() FROM PUBLIC;

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.beta_applications FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.beta_protect_application_transition() FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
