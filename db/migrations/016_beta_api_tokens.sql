-- Scoped, owner-bound API v1 bearer tokens, durable rate-limit buckets, and
-- append-only security evidence. The API remains disabled unless the runtime
-- feature gate is explicitly enabled; applying this migration exposes no route.

-- Stable API resource identifiers never encode imported names, GEDCOM xrefs, or
-- internal archive keys. PostgreSQL 16 provides gen_random_uuid() in core.
ALTER TABLE public.archives
  ADD COLUMN api_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.people
  ADD COLUMN api_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.person_facts
  ADD COLUMN api_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.sources
  ADD COLUMN api_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.research_cases
  ADD COLUMN api_id uuid NOT NULL DEFAULT gen_random_uuid();

-- Legacy values are not rewritten during this expansion. NOT VALID keeps the
-- upgrade compatible while enforcing the public 0..1 contract on every new
-- or changed API-visible confidence value; projections also reject old outliers.
ALTER TABLE public.person_facts
  ADD CONSTRAINT person_facts_api_confidence_range
  CHECK (confidence >= 0 AND confidence <= 1) NOT VALID;
ALTER TABLE public.sources
  ADD CONSTRAINT sources_api_confidence_range
  CHECK (confidence >= 0 AND confidence <= 1) NOT VALID;

CREATE UNIQUE INDEX archives_api_id_unique
  ON public.archives (api_id);
CREATE UNIQUE INDEX people_archive_api_id_unique
  ON public.people (archive_id, api_id);
CREATE UNIQUE INDEX person_facts_archive_api_id_unique
  ON public.person_facts (archive_id, api_id);
CREATE UNIQUE INDEX sources_archive_api_id_unique
  ON public.sources (archive_id, api_id);
CREATE UNIQUE INDEX research_cases_archive_api_id_unique
  ON public.research_cases (archive_id, api_id);

CREATE INDEX people_archive_api_cursor_idx
  ON public.people (archive_id, sort_order, api_id);
CREATE INDEX sources_archive_api_cursor_idx
  ON public.sources (archive_id, sort_order, api_id);
CREATE INDEX research_cases_archive_api_cursor_idx
  ON public.research_cases (archive_id, sort_order, api_id);

CREATE FUNCTION public.api_protect_resource_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.api_id IS DISTINCT FROM OLD.api_id THEN
    RAISE EXCEPTION 'API resource identifiers are immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER archives_api_id_immutable
  BEFORE UPDATE ON public.archives
  FOR EACH ROW EXECUTE FUNCTION public.api_protect_resource_id();
CREATE TRIGGER people_api_id_immutable
  BEFORE UPDATE ON public.people
  FOR EACH ROW EXECUTE FUNCTION public.api_protect_resource_id();
CREATE TRIGGER person_facts_api_id_immutable
  BEFORE UPDATE ON public.person_facts
  FOR EACH ROW EXECUTE FUNCTION public.api_protect_resource_id();
CREATE TRIGGER sources_api_id_immutable
  BEFORE UPDATE ON public.sources
  FOR EACH ROW EXECUTE FUNCTION public.api_protect_resource_id();
CREATE TRIGGER research_cases_api_id_immutable
  BEFORE UPDATE ON public.research_cases
  FOR EACH ROW EXECUTE FUNCTION public.api_protect_resource_id();

CREATE TABLE public.api_tokens (
  id text PRIMARY KEY,
  archive_id text NOT NULL REFERENCES public.archives(id) ON DELETE RESTRICT,
  user_id text NOT NULL,
  name text NOT NULL CHECK (
    length(btrim(name)) BETWEEN 1 AND 80
    AND name = btrim(name)
    AND name !~ '[[:cntrl:]]'
  ),
  prefix text NOT NULL UNIQUE CHECK (prefix ~ '^kr_beta_[A-Za-z0-9_-]{8}$'),
  digest text NOT NULL UNIQUE CHECK (digest ~ '^[a-f0-9]{64}$'),
  scopes text[] NOT NULL CHECK (
    cardinality(scopes) BETWEEN 1 AND 5
    AND scopes <@ ARRAY[
      'archive:read', 'cases:read', 'sources:read', 'reports:read', 'archive:export'
    ]::text[]
    AND cardinality(scopes) =
      CASE WHEN 'archive:read' = ANY(scopes) THEN 1 ELSE 0 END
      + CASE WHEN 'cases:read' = ANY(scopes) THEN 1 ELSE 0 END
      + CASE WHEN 'sources:read' = ANY(scopes) THEN 1 ELSE 0 END
      + CASE WHEN 'reports:read' = ANY(scopes) THEN 1 ELSE 0 END
      + CASE WHEN 'archive:export' = ANY(scopes) THEN 1 ELSE 0 END
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (expires_at <= created_at + interval '366 days'),
  CHECK (last_used_at IS NULL OR last_used_at >= created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX api_tokens_archive_owner_idx
  ON public.api_tokens (archive_id, user_id, created_at DESC, id);

CREATE INDEX api_tokens_active_expiry_idx
  ON public.api_tokens (expires_at, id)
  WHERE revoked_at IS NULL;

CREATE TABLE public.api_rate_limit_buckets (
  token_id text NOT NULL REFERENCES public.api_tokens(id) ON DELETE RESTRICT,
  bucket_kind text NOT NULL CHECK (
    bucket_kind IN ('standard-minute', 'standard-day', 'export-minute', 'export-day')
  ),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (token_id, bucket_kind),
  CHECK (expires_at > window_started_at),
  CHECK (updated_at >= window_started_at)
);

CREATE INDEX api_rate_limit_buckets_expiry_idx
  ON public.api_rate_limit_buckets (expires_at, token_id, bucket_kind);

CREATE TABLE public.security_events (
  id text PRIMARY KEY,
  archive_id text NOT NULL REFERENCES public.archives(id) ON DELETE RESTRICT,
  actor_kind text NOT NULL CHECK (actor_kind IN ('owner', 'operator', 'token')),
  actor_user_id text,
  token_id text NOT NULL,
  event_type text NOT NULL CHECK (
    event_type IN ('api-token-created', 'api-token-revoked', 'api-export-used')
  ),
  request_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (actor_kind IN ('owner', 'token') AND actor_user_id IS NOT NULL)
    OR (actor_kind = 'operator' AND actor_user_id IS NULL)
  )
);

CREATE INDEX security_events_archive_time_idx
  ON public.security_events (archive_id, occurred_at DESC, id);

CREATE INDEX security_events_token_time_idx
  ON public.security_events (token_id, occurred_at DESC, id);

-- Token identity and authority are immutable. Runtime updates may advance the
-- last-used timestamp or perform the one-way revocation transition only.
CREATE FUNCTION public.api_protect_token_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'API token rows cannot be deleted';
  END IF;
  IF ROW(
    NEW.id, NEW.archive_id, NEW.user_id, NEW.name, NEW.prefix, NEW.digest,
    NEW.scopes, NEW.created_at, NEW.expires_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.archive_id, OLD.user_id, OLD.name, OLD.prefix, OLD.digest,
    OLD.scopes, OLD.created_at, OLD.expires_at
  ) THEN
    RAISE EXCEPTION 'API token identity and authority are immutable';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'API token revocation is permanent';
  END IF;
  IF NEW.last_used_at IS NOT NULL AND OLD.last_used_at IS NOT NULL
     AND NEW.last_used_at < OLD.last_used_at THEN
    RAISE EXCEPTION 'API token last-used time cannot move backward';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER api_tokens_protected_transition
  BEFORE UPDATE OR DELETE ON public.api_tokens
  FOR EACH ROW EXECUTE FUNCTION public.api_protect_token_transition();

CREATE FUNCTION public.api_reject_security_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'API security events are append-only';
END
$$;

CREATE TRIGGER security_events_append_only
  BEFORE UPDATE OR DELETE ON public.security_events
  FOR EACH ROW EXECUTE FUNCTION public.api_reject_security_event_mutation();

ALTER TABLE public.api_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_rate_limit_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.api_tokens FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.api_rate_limit_buckets FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.security_events FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.api_protect_resource_id() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.api_protect_token_transition() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.api_reject_security_event_mutation() FROM PUBLIC;

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.api_tokens FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.api_rate_limit_buckets FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.security_events FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.api_protect_resource_id() FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.api_protect_token_transition() FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.api_reject_security_event_mutation() FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
