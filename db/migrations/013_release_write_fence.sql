-- Durable, application-enforced write fence for production release and
-- recovery operations. Rows remain after release so stale automation cannot
-- silently reuse a fence identifier for a different commit.

CREATE TABLE public.release_write_fences (
  cell text NOT NULL DEFAULT 'production' CHECK (cell = 'production'),
  fence_id text NOT NULL CHECK (fence_id ~ '^fence-[a-z0-9][a-z0-9-]{7,63}$'),
  release_commit_sha text NOT NULL CHECK (release_commit_sha ~ '^[a-f0-9]{40}$'),
  state text NOT NULL CHECK (state IN ('active', 'released')),
  activation_generation integer NOT NULL DEFAULT 1 CHECK (activation_generation >= 1),
  first_activated_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cell, fence_id),
  CHECK (
    (state = 'active' AND released_at IS NULL)
    OR (state = 'released' AND released_at IS NOT NULL)
  ),
  CHECK (first_activated_at <= activated_at),
  CHECK (activated_at <= updated_at),
  CHECK (released_at IS NULL OR activated_at <= released_at)
);

CREATE UNIQUE INDEX release_write_fences_one_active_idx
  ON public.release_write_fences (cell)
  WHERE state = 'active';

CREATE INDEX release_write_fences_release_commit_idx
  ON public.release_write_fences (release_commit_sha, updated_at DESC);

-- Fence control is server-only. Revoke explicitly instead of relying on the
-- default privileges of whichever role happens to run this migration: those
-- defaults can drift across restored cells or a changed migration owner.
REVOKE ALL PRIVILEGES ON TABLE public.release_write_fences FROM PUBLIC;

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.release_write_fences FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END
$$;
