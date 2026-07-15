-- Persist the dataset contract so a deployment configuration change cannot
-- silently turn pilot data into demo data. Existing archives are classified
-- conservatively as pilot archives; operators can provision new empty/demo
-- archives explicitly after this migration.
ALTER TABLE public.archives
  ADD COLUMN dataset_mode text NOT NULL DEFAULT 'pilot',
  ADD COLUMN demo_fixture_version integer,
  ADD CONSTRAINT archives_dataset_mode_check
    CHECK (dataset_mode IN ('empty', 'demo', 'pilot')),
  ADD CONSTRAINT archives_demo_fixture_check
    CHECK (
      (dataset_mode = 'demo' AND demo_fixture_version IS NOT NULL AND demo_fixture_version > 0)
      OR
      (dataset_mode IN ('empty', 'pilot') AND demo_fixture_version IS NULL)
    );
