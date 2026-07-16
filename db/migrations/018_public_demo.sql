-- Server-only lifecycle state for the disposable public fictional demo.
-- Raw bearer tokens, network addresses, user agents, free-form prompts,
-- family data, and provider responses must never be stored in these tables.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE public.public_demo_capacity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  cleanup_lease_owner uuid,
  cleanup_lease_expires_at timestamptz,
  last_cleanup_started_at timestamptz,
  last_cleanup_completed_at timestamptz,
  last_cleanup_failed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (cleanup_lease_owner IS NULL AND cleanup_lease_expires_at IS NULL)
    OR (cleanup_lease_owner IS NOT NULL AND cleanup_lease_expires_at IS NOT NULL)
  ),
  CHECK (
    last_cleanup_completed_at IS NULL
    OR last_cleanup_started_at IS NULL
    OR last_cleanup_completed_at >= last_cleanup_started_at
  )
);

INSERT INTO public.public_demo_capacity (singleton) VALUES (true);

CREATE TABLE public.public_demo_sessions (
  id uuid PRIMARY KEY,
  token_digest text UNIQUE CHECK (
    token_digest IS NULL OR token_digest ~ '^[a-f0-9]{64}$'
  ),
  archive_id text NOT NULL CHECK (archive_id ~ '^demo-[a-f0-9]{32}$'),
  generation integer NOT NULL DEFAULT 1 CHECK (generation BETWEEN 1 AND 6),
  status text NOT NULL CHECK (status IN (
    'provisioning', 'active', 'ended', 'expired', 'cleaned', 'failed'
  )),
  notice_version text NOT NULL CHECK (notice_version = 'public-demo-2026-07-16'),
  reset_count integer NOT NULL DEFAULT 0 CHECK (reset_count BETWEEN 0 AND 5),
  ai_attempts_used integer NOT NULL DEFAULT 0 CHECK (ai_attempts_used BETWEEN 0 AND 3),
  is_canary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  ended_at timestamptz,
  CHECK (expires_at = created_at + interval '24 hours'),
  CHECK (updated_at >= created_at),
  CHECK (ended_at IS NULL OR ended_at >= created_at),
  CHECK (
    (status IN ('provisioning', 'active') AND token_digest IS NOT NULL AND ended_at IS NULL)
    OR (status IN ('ended', 'expired', 'cleaned', 'failed') AND token_digest IS NULL AND ended_at IS NOT NULL)
  )
);

CREATE INDEX public_demo_sessions_capacity_idx
  ON public.public_demo_sessions (status, expires_at, id)
  WHERE status IN ('provisioning', 'active');
CREATE INDEX public_demo_sessions_retention_idx
  ON public.public_demo_sessions (ended_at, id)
  WHERE status IN ('ended', 'expired', 'cleaned', 'failed');

CREATE TABLE public.public_demo_rate_limits (
  subject_digest text NOT NULL CHECK (subject_digest ~ '^[a-f0-9]{64}$'),
  window_kind text NOT NULL CHECK (window_kind IN ('hour', 'day')),
  request_count integer NOT NULL CHECK (request_count BETWEEN 0 AND 10),
  window_started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (subject_digest, window_kind),
  CHECK (
    (window_kind = 'hour' AND expires_at = window_started_at + interval '1 hour')
    OR (window_kind = 'day' AND expires_at = window_started_at + interval '24 hours')
  ),
  CHECK (updated_at >= window_started_at AND updated_at <= expires_at)
);

CREATE INDEX public_demo_rate_limits_retention_idx
  ON public.public_demo_rate_limits (expires_at, subject_digest, window_kind);

CREATE TABLE public.public_demo_generations (
  session_id uuid NOT NULL REFERENCES public.public_demo_sessions(id) ON DELETE CASCADE,
  generation integer NOT NULL CHECK (generation BETWEEN 1 AND 6),
  archive_id text NOT NULL UNIQUE CHECK (archive_id ~ '^demo-[a-f0-9]{32}$'),
  state text NOT NULL CHECK (state IN ('provisioning', 'active', 'retired', 'cleaned', 'failed')),
  created_at timestamptz NOT NULL,
  retired_at timestamptz,
  cleaned_at timestamptz,
  PRIMARY KEY (session_id, generation),
  UNIQUE (session_id, generation, archive_id),
  CHECK (retired_at IS NULL OR retired_at >= created_at),
  CHECK (cleaned_at IS NULL OR cleaned_at >= COALESCE(retired_at, created_at)),
  CHECK (state <> 'active' OR retired_at IS NULL),
  CHECK (state <> 'cleaned' OR cleaned_at IS NOT NULL)
);

CREATE INDEX public_demo_generations_cleanup_idx
  ON public.public_demo_generations (state, retired_at, session_id, generation)
  WHERE state IN ('retired', 'failed');

CREATE TABLE public.public_demo_ai_attempts (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.public_demo_sessions(id) ON DELETE CASCADE,
  archive_id text NOT NULL CHECK (archive_id ~ '^demo-[a-f0-9]{32}$'),
  generation integer NOT NULL CHECK (generation BETWEEN 1 AND 6),
  prompt_id text NOT NULL CHECK (prompt_id IN (
    'case_next_steps', 'evidence_gaps', 'dna_cluster_summary'
  )),
  state text NOT NULL CHECK (state IN ('running', 'completed', 'failed', 'timed-out')),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  lease_expires_at timestamptz NOT NULL,
  FOREIGN KEY (session_id, generation, archive_id)
    REFERENCES public.public_demo_generations(session_id, generation, archive_id)
    ON DELETE CASCADE,
  CHECK (lease_expires_at > started_at),
  CHECK (
    (state = 'running' AND completed_at IS NULL)
    OR (state <> 'running' AND completed_at >= started_at)
  )
);

CREATE INDEX public_demo_ai_attempts_active_idx
  ON public.public_demo_ai_attempts (state, lease_expires_at, id)
  WHERE state = 'running';
CREATE INDEX public_demo_ai_attempts_daily_idx
  ON public.public_demo_ai_attempts (started_at, id);

CREATE TABLE public.public_demo_events (
  id uuid PRIMARY KEY,
  session_id uuid REFERENCES public.public_demo_sessions(id) ON DELETE SET NULL,
  event_name text NOT NULL CHECK (event_name IN (
    'landing_viewed', 'session_started', 'guide_started', 'outcome_completed',
    'ai_attempted', 'reset', 'feedback_submitted', 'beta_cta_clicked',
    'capacity_rejected'
  )),
  usefulness smallint CHECK (usefulness BETWEEN 1 AND 5),
  clarity smallint CHECK (clarity BETWEEN 1 AND 5),
  feature_interest text CHECK (feature_interest IN (
    'research-cases', 'sources', 'gedcom', 'dna', 'ai', 'public-family'
  )),
  beta_interest boolean,
  occurred_at timestamptz NOT NULL,
  retention_expires_at timestamptz NOT NULL,
  CHECK (retention_expires_at = occurred_at + interval '30 days'),
  CHECK (
    (event_name = 'feedback_submitted'
      AND usefulness IS NOT NULL
      AND clarity IS NOT NULL
      AND feature_interest IS NOT NULL
      AND beta_interest IS NOT NULL)
    OR (event_name <> 'feedback_submitted'
      AND usefulness IS NULL
      AND clarity IS NULL
      AND feature_interest IS NULL
      AND beta_interest IS NULL)
  )
);

CREATE INDEX public_demo_events_retention_idx
  ON public.public_demo_events (retention_expires_at, id);
CREATE INDEX public_demo_events_funnel_idx
  ON public.public_demo_events (event_name, occurred_at, id);

ALTER TABLE public.public_demo_capacity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_demo_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_demo_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_demo_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_demo_ai_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_demo_events ENABLE ROW LEVEL SECURITY;

-- RLS remains effective for a non-owner runtime role. Access is still
-- server-only because PUBLIC and Supabase API roles receive no table ACL;
-- the reviewed runtime-grant workflow grants the bounded DML separately.
CREATE POLICY public_demo_capacity_server_policy ON public.public_demo_capacity
  USING (true) WITH CHECK (true);
CREATE POLICY public_demo_sessions_server_policy ON public.public_demo_sessions
  USING (true) WITH CHECK (true);
CREATE POLICY public_demo_rate_limits_server_policy ON public.public_demo_rate_limits
  USING (true) WITH CHECK (true);
CREATE POLICY public_demo_generations_server_policy ON public.public_demo_generations
  USING (true) WITH CHECK (true);
CREATE POLICY public_demo_ai_attempts_server_policy ON public.public_demo_ai_attempts
  USING (true) WITH CHECK (true);
CREATE POLICY public_demo_events_server_policy ON public.public_demo_events
  USING (true) WITH CHECK (true);

REVOKE ALL PRIVILEGES ON TABLE public.public_demo_capacity FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.public_demo_sessions FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.public_demo_rate_limits FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.public_demo_generations FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.public_demo_ai_attempts FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.public_demo_events FROM PUBLIC;

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.public_demo_capacity FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.public_demo_sessions FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.public_demo_rate_limits FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.public_demo_generations FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.public_demo_ai_attempts FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.public_demo_events FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
