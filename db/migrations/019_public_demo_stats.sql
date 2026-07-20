-- Durable aggregate usage statistics for the disposable public fictional demo.
-- The singleton row stores only an anonymous completed-outcome counter; raw
-- bearer tokens, network addresses, user agents, free-form prompts, family
-- data, and provider responses must never be stored in this table.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE public.public_demo_stats (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  outcomes_completed_total bigint NOT NULL DEFAULT 0,
  started_counting_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.public_demo_stats (singleton) VALUES (true);

ALTER TABLE public.public_demo_stats ENABLE ROW LEVEL SECURITY;

-- RLS remains effective for a non-owner runtime role. Access is still
-- server-only because PUBLIC and Supabase API roles receive no table ACL;
-- the reviewed runtime-grant workflow grants the bounded DML separately.
CREATE POLICY public_demo_stats_server_policy ON public.public_demo_stats
  USING (true) WITH CHECK (true);

REVOKE ALL PRIVILEGES ON TABLE public.public_demo_stats FROM PUBLIC;

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.public_demo_stats FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
