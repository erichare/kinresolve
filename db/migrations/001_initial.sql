CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS archives (
  id text PRIMARY KEY,
  name text NOT NULL,
  tagline text NOT NULL DEFAULT '',
  slug text NOT NULL UNIQUE,
  accent_color text NOT NULL DEFAULT '#00634f',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'contributor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  slug text NOT NULL,
  display_name text NOT NULL,
  given_name text,
  surname text,
  sex text CHECK (sex IN ('M', 'F', 'U') OR sex IS NULL),
  birth_date text,
  birth_place text,
  death_date text,
  death_place text,
  living_status text NOT NULL DEFAULT 'unknown' CHECK (living_status IN ('living', 'deceased', 'unknown')),
  privacy text NOT NULL DEFAULT 'private' CHECK (privacy IN ('public', 'private', 'sensitive')),
  published boolean NOT NULL DEFAULT false,
  relatives text[] NOT NULL DEFAULT '{}',
  notes text,
  confidence numeric(4,3) NOT NULL DEFAULT 0.500,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS person_facts (
  id text PRIMARY KEY,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  fact_type text NOT NULL,
  date_text text,
  place_text text,
  value_text text,
  source_text text,
  privacy text CHECK (privacy IN ('public', 'private', 'sensitive') OR privacy IS NULL),
  confidence numeric(4,3) NOT NULL DEFAULT 0.500,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS import_snapshots (
  id text PRIMARY KEY,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  source_name text NOT NULL,
  checksum text NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  record_count integer NOT NULL DEFAULT 0,
  people_imported integer NOT NULL DEFAULT 0,
  sources_imported integer NOT NULL DEFAULT 0,
  raw_record_count integer NOT NULL DEFAULT 0,
  backup_id text,
  applied_at timestamptz NOT NULL DEFAULT now(),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS raw_records (
  id text PRIMARY KEY,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  import_id text NOT NULL,
  xref text,
  record_type text NOT NULL,
  raw_text text NOT NULL,
  checksum text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS workspace_backups (
  id text PRIMARY KEY,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  storage_key text NOT NULL,
  people_count integer NOT NULL DEFAULT 0,
  sources_count integer NOT NULL DEFAULT 0,
  cases_count integer NOT NULL DEFAULT 0,
  dna_match_count integer NOT NULL DEFAULT 0,
  import_count integer NOT NULL DEFAULT 0,
  raw_record_count integer NOT NULL DEFAULT 0,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sources (
  id text PRIMARY KEY,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  title text NOT NULL,
  source_type text NOT NULL DEFAULT 'Document',
  import_id text,
  raw_record_id text,
  file_name text,
  storage_key text,
  mime_type text,
  size_bytes bigint,
  repository text,
  url text,
  ancestry_apid text,
  citation_date text,
  linked_person_id text,
  linked_case_id text,
  transcript text,
  notes text,
  privacy text NOT NULL DEFAULT 'private' CHECK (privacy IN ('public', 'private', 'sensitive')),
  confidence numeric(4,3) NOT NULL DEFAULT 0.500,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research_cases (
  id text PRIMARY KEY,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  title text NOT NULL,
  question text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'planning', 'paused', 'resolved')),
  focus text NOT NULL DEFAULT '',
  privacy text NOT NULL DEFAULT 'private' CHECK (privacy IN ('public', 'private', 'sensitive')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hypotheses (
  id text PRIMARY KEY,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  case_id text NOT NULL REFERENCES research_cases(id) ON DELETE CASCADE,
  statement text NOT NULL,
  confidence numeric(4,3) NOT NULL DEFAULT 0.500,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'supported', 'weakened', 'rejected')),
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS evidence_items (
  id text PRIMARY KEY,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  case_id text NOT NULL REFERENCES research_cases(id) ON DELETE CASCADE,
  title text NOT NULL,
  evidence_type text NOT NULL,
  summary text NOT NULL,
  confidence numeric(4,3) NOT NULL DEFAULT 0.500,
  linked_person_id text,
  linked_dna_match_id text,
  source_id text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  case_id text NOT NULL REFERENCES research_cases(id) ON DELETE CASCADE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  due_at timestamptz,
  assignee_id text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dna_matches (
  id text PRIMARY KEY,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  total_cm numeric(8,2) NOT NULL,
  longest_segment_cm numeric(8,2),
  shared_dna_percent numeric(8,4),
  predicted_relationship text,
  side text NOT NULL DEFAULT 'unknown' CHECK (side IN ('maternal', 'paternal', 'both', 'unknown')),
  tree_status text NOT NULL DEFAULT 'unknown' CHECK (tree_status IN ('none', 'private', 'partial', 'public', 'unknown')),
  surnames text[] NOT NULL DEFAULT '{}',
  places text[] NOT NULL DEFAULT '{}',
  shared_matches text[] NOT NULL DEFAULT '{}',
  notes text NOT NULL DEFAULT '',
  ancestry_url text,
  triage_status text NOT NULL DEFAULT 'needs_review' CHECK (triage_status IN ('needs_review', 'triaged', 'ignored', 'high_priority')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dna_hypotheses (
  id text PRIMARY KEY,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  dna_match_id text NOT NULL REFERENCES dna_matches(id) ON DELETE CASCADE,
  likely_branch text NOT NULL,
  likely_generation text NOT NULL,
  geography text[] NOT NULL DEFAULT '{}',
  candidate_common_ancestors text[] NOT NULL DEFAULT '{}',
  confidence numeric(4,3) NOT NULL DEFAULT 0.500,
  explanation text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  uncertainty jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS embeddings (
  id text PRIMARY KEY,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  content text NOT NULL,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id text PRIMARY KEY,
  archive_id text NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  requested_by text,
  run_type text NOT NULL DEFAULT 'analysis',
  provider text NOT NULL DEFAULT 'local',
  model text NOT NULL DEFAULT 'local',
  question text NOT NULL,
  answer text NOT NULL,
  status text NOT NULL CHECK (status IN ('ready', 'configuration_required', 'provider_error')),
  provider_status text NOT NULL DEFAULT 'not_configured' CHECK (provider_status IN ('not_configured', 'completed', 'failed')),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  uncertainty jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
  context_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  anomaly_count integer NOT NULL DEFAULT 0,
  linked_case_id text,
  prompt_redacted text NOT NULL DEFAULT '',
  error text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS people_archive_name_idx ON people (archive_id, surname, given_name);
CREATE INDEX IF NOT EXISTS people_archive_slug_idx ON people (archive_id, slug);
CREATE INDEX IF NOT EXISTS facts_person_idx ON person_facts (person_id, fact_type);
CREATE INDEX IF NOT EXISTS sources_archive_link_idx ON sources (archive_id, linked_person_id, linked_case_id);
CREATE INDEX IF NOT EXISTS cases_archive_status_idx ON research_cases (archive_id, status);
CREATE INDEX IF NOT EXISTS tasks_case_status_idx ON tasks (case_id, status);
CREATE INDEX IF NOT EXISTS dna_archive_status_idx ON dna_matches (archive_id, triage_status);
CREATE INDEX IF NOT EXISTS embeddings_archive_entity_idx ON embeddings (archive_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS ai_runs_archive_created_idx ON ai_runs (archive_id, created_at DESC);
