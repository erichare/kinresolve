-- Invitation-only hosted onboarding, exact approved legal acceptance,
-- single-use email verification, replay protection, and privacy-preserving
-- durable auth limits. Applying the migration never opens onboarding: the
-- singleton control starts paused and requires a signed operator transition.

CREATE TABLE public.beta_invitation_control (
  scope text PRIMARY KEY CHECK (scope = 'hosted'),
  state text NOT NULL CHECK (state IN ('active', 'paused')),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation >= 1),
  reason_code text NOT NULL CHECK (
    reason_code IN ('launch-gate', 'operator', 'maintenance', 'incident', 'email-disabled', 'cleanup')
  ),
  updated_by_digest text CHECK (updated_by_digest ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.beta_invitation_control (scope, state, reason_code)
VALUES ('hosted', 'paused', 'launch-gate');

CREATE TABLE public.beta_invitations (
  id text PRIMARY KEY,
  archive_id text NOT NULL REFERENCES public.archives(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('initial-owner', 'member')),
  email_digest text NOT NULL CHECK (email_digest ~ '^[a-f0-9]{64}$'),
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'contributor', 'viewer')),
  token_digest text UNIQUE CHECK (token_digest IS NULL OR token_digest ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'consumed', 'revoked', 'expired')),
  participation_terms_version text NOT NULL CHECK (length(btrim(participation_terms_version)) BETWEEN 1 AND 120),
  participation_terms_sha256 text NOT NULL CHECK (participation_terms_sha256 ~ '^[a-f0-9]{64}$'),
  participation_terms_url text NOT NULL CHECK (
    length(participation_terms_url) <= 2048 AND participation_terms_url ~ '^https://[^?#]+$'
  ),
  privacy_notice_version text NOT NULL CHECK (length(btrim(privacy_notice_version)) BETWEEN 1 AND 120),
  privacy_notice_sha256 text NOT NULL CHECK (privacy_notice_sha256 ~ '^[a-f0-9]{64}$'),
  privacy_notice_url text NOT NULL CHECK (
    length(privacy_notice_url) <= 2048 AND privacy_notice_url ~ '^https://[^?#]+$'
  ),
  beta_boundary_version text NOT NULL CHECK (length(btrim(beta_boundary_version)) BETWEEN 1 AND 120),
  beta_boundary_sha256 text NOT NULL CHECK (beta_boundary_sha256 ~ '^[a-f0-9]{64}$'),
  beta_boundary_url text NOT NULL CHECK (
    length(beta_boundary_url) <= 2048 AND beta_boundary_url ~ '^https://[^?#]+$'
  ),
  issued_by_digest text NOT NULL CHECK (issued_by_digest ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  closed_at timestamptz,
  consumed_by_user_id text REFERENCES public."user"("id") ON DELETE RESTRICT,
  UNIQUE (id, archive_id, consumed_by_user_id),
  CHECK (
    (purpose = 'initial-owner' AND role = 'owner')
    OR (purpose = 'member' AND role IN ('admin', 'editor', 'contributor', 'viewer'))
  ),
  CHECK (expires_at > issued_at),
  CHECK (closed_at IS NULL OR closed_at >= issued_at),
  CHECK (
    (state = 'pending' AND token_digest IS NOT NULL AND closed_at IS NULL AND consumed_by_user_id IS NULL)
    OR (state = 'consumed' AND token_digest IS NULL AND closed_at IS NOT NULL AND consumed_by_user_id IS NOT NULL)
    OR (state IN ('revoked', 'expired') AND token_digest IS NULL AND closed_at IS NOT NULL AND consumed_by_user_id IS NULL)
  )
);

CREATE UNIQUE INDEX beta_invitations_one_pending_email_idx
  ON public.beta_invitations (archive_id, email_digest)
  WHERE state = 'pending';

-- This index is the concurrency backstop for initial ownership. A pending
-- initial-owner invitation must be closed before reissue; once one succeeds,
-- no second initial-owner invitation can ever become live for that archive.
CREATE UNIQUE INDEX beta_invitations_one_initial_owner_lifecycle_idx
  ON public.beta_invitations (archive_id)
  WHERE purpose = 'initial-owner' AND state IN ('pending', 'consumed');

CREATE INDEX beta_invitations_expiry_idx
  ON public.beta_invitations (expires_at, id)
  WHERE state = 'pending';

CREATE TABLE public.beta_email_verification_tokens (
  id text PRIMARY KEY,
  invitation_id text NOT NULL,
  archive_id text NOT NULL,
  user_id text NOT NULL,
  email_digest text NOT NULL CHECK (email_digest ~ '^[a-f0-9]{64}$'),
  token_digest text UNIQUE CHECK (token_digest IS NULL OR token_digest ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'consumed', 'revoked', 'expired')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  closed_at timestamptz,
  UNIQUE (id, archive_id, user_id),
  FOREIGN KEY (archive_id, user_id)
    REFERENCES public.memberships(archive_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (invitation_id, archive_id, user_id)
    REFERENCES public.beta_invitations(id, archive_id, consumed_by_user_id) ON DELETE RESTRICT,
  CHECK (expires_at > issued_at),
  CHECK (closed_at IS NULL OR closed_at >= issued_at),
  CHECK (
    (state = 'pending' AND token_digest IS NOT NULL AND closed_at IS NULL)
    OR (state IN ('consumed', 'revoked', 'expired') AND token_digest IS NULL AND closed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX beta_email_verification_one_pending_user_idx
  ON public.beta_email_verification_tokens (user_id)
  WHERE state = 'pending';

CREATE INDEX beta_email_verification_invitation_idx
  ON public.beta_email_verification_tokens (invitation_id, issued_at DESC);

CREATE INDEX beta_email_verification_expiry_idx
  ON public.beta_email_verification_tokens (expires_at, id)
  WHERE state = 'pending';

CREATE TABLE public.beta_terms_acceptances (
  id text PRIMARY KEY,
  invitation_id text NOT NULL UNIQUE,
  archive_id text NOT NULL,
  user_id text NOT NULL,
  participation_terms_version text NOT NULL CHECK (length(btrim(participation_terms_version)) BETWEEN 1 AND 120),
  participation_terms_sha256 text NOT NULL CHECK (participation_terms_sha256 ~ '^[a-f0-9]{64}$'),
  participation_terms_url text NOT NULL CHECK (
    length(participation_terms_url) <= 2048 AND participation_terms_url ~ '^https://[^?#]+$'
  ),
  privacy_notice_version text NOT NULL CHECK (length(btrim(privacy_notice_version)) BETWEEN 1 AND 120),
  privacy_notice_sha256 text NOT NULL CHECK (privacy_notice_sha256 ~ '^[a-f0-9]{64}$'),
  privacy_notice_url text NOT NULL CHECK (
    length(privacy_notice_url) <= 2048 AND privacy_notice_url ~ '^https://[^?#]+$'
  ),
  beta_boundary_version text NOT NULL CHECK (length(btrim(beta_boundary_version)) BETWEEN 1 AND 120),
  beta_boundary_sha256 text NOT NULL CHECK (beta_boundary_sha256 ~ '^[a-f0-9]{64}$'),
  beta_boundary_url text NOT NULL CHECK (
    length(beta_boundary_url) <= 2048 AND beta_boundary_url ~ '^https://[^?#]+$'
  ),
  acceptance_method text NOT NULL CHECK (acceptance_method = 'invitation-clickwrap'),
  request_id uuid NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (archive_id, user_id)
    REFERENCES public.memberships(archive_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (invitation_id, archive_id, user_id)
    REFERENCES public.beta_invitations(id, archive_id, consumed_by_user_id) ON DELETE RESTRICT
);

CREATE INDEX beta_terms_acceptances_membership_idx
  ON public.beta_terms_acceptances (archive_id, user_id, accepted_at DESC);

CREATE TABLE public.beta_identity_audit_events (
  id text PRIMARY KEY,
  invitation_id text REFERENCES public.beta_invitations(id) ON DELETE RESTRICT,
  verification_id text REFERENCES public.beta_email_verification_tokens(id) ON DELETE RESTRICT,
  archive_id text REFERENCES public.archives(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'invitation-issued',
    'invitation-delivered',
    'invitation-delivery-failed',
    'invitation-consumed',
    'invitation-revoked',
    'invitation-expired',
    'invitations-paused',
    'invitations-resumed',
    'email-verification-issued',
    'email-verification-delivered',
    'email-verification-delivery-failed',
    'email-verification-completed',
    'email-verification-revoked',
    'email-verification-expired',
    'password-recovery-requested',
    'password-recovery-completed',
    'password-changed',
    'sessions-revoked',
    'security-notification-delivered',
    'security-notification-delivery-failed'
  )),
  actor_kind text NOT NULL CHECK (actor_kind IN ('operator', 'participant', 'system')),
  actor_digest text CHECK (actor_digest IS NULL OR actor_digest ~ '^[a-f0-9]{64}$'),
  subject_digest text CHECK (subject_digest IS NULL OR subject_digest ~ '^[a-f0-9]{64}$'),
  request_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (
      event_type IN (
        'invitation-issued', 'invitation-delivered', 'invitation-delivery-failed',
        'invitation-consumed', 'invitation-revoked', 'invitation-expired'
      )
      AND invitation_id IS NOT NULL AND verification_id IS NULL AND archive_id IS NOT NULL
    )
    OR (
      event_type IN ('invitations-paused', 'invitations-resumed')
      AND invitation_id IS NULL AND verification_id IS NULL AND archive_id IS NULL
    )
    OR (
      event_type IN (
        'email-verification-issued', 'email-verification-delivered',
        'email-verification-delivery-failed', 'email-verification-completed',
        'email-verification-revoked', 'email-verification-expired'
      )
      AND invitation_id IS NOT NULL AND verification_id IS NOT NULL AND archive_id IS NOT NULL
    )
    OR (
      event_type IN (
        'password-recovery-requested', 'password-recovery-completed', 'password-changed',
        'sessions-revoked', 'security-notification-delivered',
        'security-notification-delivery-failed'
      )
      AND invitation_id IS NULL AND verification_id IS NULL AND subject_digest IS NOT NULL
    )
  )
);

CREATE INDEX beta_identity_audit_events_invitation_idx
  ON public.beta_identity_audit_events (invitation_id, occurred_at DESC)
  WHERE invitation_id IS NOT NULL;

CREATE INDEX beta_identity_audit_events_verification_idx
  ON public.beta_identity_audit_events (verification_id, occurred_at DESC)
  WHERE verification_id IS NOT NULL;

CREATE INDEX beta_identity_audit_events_time_idx
  ON public.beta_identity_audit_events (occurred_at DESC, event_type);

CREATE TABLE public.auth_rate_limit_buckets (
  bucket_digest text PRIMARY KEY CHECK (bucket_digest ~ '^[a-f0-9]{64}$'),
  request_count integer NOT NULL CHECK (request_count >= 1),
  window_started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > window_started_at),
  CHECK (updated_at >= window_started_at)
);

CREATE INDEX auth_rate_limit_buckets_expiry_idx
  ON public.auth_rate_limit_buckets (expires_at, bucket_digest);

CREATE TABLE public.beta_operator_nonces (
  operator_key_digest text NOT NULL CHECK (operator_key_digest ~ '^[a-f0-9]{64}$'),
  nonce uuid NOT NULL,
  request_timestamp timestamptz NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (operator_key_digest, nonce),
  CHECK (expires_at > accepted_at),
  CHECK (
    request_timestamp BETWEEN accepted_at - interval '15 minutes'
      AND accepted_at + interval '15 minutes'
  )
);

CREATE INDEX beta_operator_nonces_expiry_idx
  ON public.beta_operator_nonces (expires_at, operator_key_digest, nonce);

-- Legal acceptance and identity audit rows are evidence, not mutable product
-- state. Their only supported lifecycle is insertion followed by destruction
-- of the isolated data cell itself.
CREATE FUNCTION public.beta_reject_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'beta evidence rows are append-only';
END
$$;

CREATE TRIGGER beta_terms_acceptances_append_only
  BEFORE UPDATE OR DELETE ON public.beta_terms_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.beta_reject_evidence_mutation();

CREATE TRIGGER beta_identity_audit_events_append_only
  BEFORE UPDATE OR DELETE ON public.beta_identity_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.beta_reject_evidence_mutation();

-- Invitation and verification rows have one permitted mutation: pending to a
-- terminal state while clearing the bearer-token digest. Identity, purpose,
-- legal metadata, expiry, and terminal evidence cannot be rewritten.
CREATE FUNCTION public.beta_protect_invitation_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'beta invitation rows cannot be deleted';
  END IF;
  IF OLD.state <> 'pending' OR NEW.state = 'pending' THEN
    RAISE EXCEPTION 'invalid beta invitation state transition';
  END IF;
  IF ROW(
    NEW.id, NEW.archive_id, NEW.purpose, NEW.email_digest, NEW.role,
    NEW.participation_terms_version, NEW.participation_terms_sha256, NEW.participation_terms_url,
    NEW.privacy_notice_version, NEW.privacy_notice_sha256, NEW.privacy_notice_url,
    NEW.beta_boundary_version, NEW.beta_boundary_sha256, NEW.beta_boundary_url,
    NEW.issued_by_digest, NEW.issued_at, NEW.expires_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.archive_id, OLD.purpose, OLD.email_digest, OLD.role,
    OLD.participation_terms_version, OLD.participation_terms_sha256, OLD.participation_terms_url,
    OLD.privacy_notice_version, OLD.privacy_notice_sha256, OLD.privacy_notice_url,
    OLD.beta_boundary_version, OLD.beta_boundary_sha256, OLD.beta_boundary_url,
    OLD.issued_by_digest, OLD.issued_at, OLD.expires_at
  ) THEN
    RAISE EXCEPTION 'beta invitation identity and legal metadata are immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER beta_invitations_protected_transition
  BEFORE UPDATE OR DELETE ON public.beta_invitations
  FOR EACH ROW EXECUTE FUNCTION public.beta_protect_invitation_transition();

CREATE FUNCTION public.beta_protect_verification_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'beta email-verification rows cannot be deleted';
  END IF;
  IF OLD.state <> 'pending' OR NEW.state = 'pending' THEN
    RAISE EXCEPTION 'invalid beta email-verification state transition';
  END IF;
  IF ROW(
    NEW.id, NEW.invitation_id, NEW.archive_id, NEW.user_id,
    NEW.email_digest, NEW.issued_at, NEW.expires_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.invitation_id, OLD.archive_id, OLD.user_id,
    OLD.email_digest, OLD.issued_at, OLD.expires_at
  ) THEN
    RAISE EXCEPTION 'beta email-verification identity is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER beta_email_verification_protected_transition
  BEFORE UPDATE OR DELETE ON public.beta_email_verification_tokens
  FOR EACH ROW EXECUTE FUNCTION public.beta_protect_verification_transition();

ALTER TABLE public.beta_invitation_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beta_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beta_email_verification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beta_terms_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beta_identity_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_rate_limit_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beta_operator_nonces ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.beta_invitation_control FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.beta_invitations FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.beta_email_verification_tokens FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.beta_terms_acceptances FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.beta_identity_audit_events FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.auth_rate_limit_buckets FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.beta_operator_nonces FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.beta_reject_evidence_mutation() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.beta_protect_invitation_transition() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.beta_protect_verification_transition() FROM PUBLIC;

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.beta_invitation_control FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.beta_invitations FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.beta_email_verification_tokens FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.beta_terms_acceptances FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.beta_identity_audit_events FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.auth_rate_limit_buckets FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.beta_operator_nonces FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.beta_reject_evidence_mutation() FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.beta_protect_invitation_transition() FROM %I', api_role);
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.beta_protect_verification_transition() FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
