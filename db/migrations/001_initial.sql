CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE archives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  tagline text NOT NULL DEFAULT '',
  slug text NOT NULL UNIQUE,
  accent_color text NOT NULL DEFAULT '#00634f',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'contributor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE import_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  source_name text NOT NULL,
  source_kind text NOT NULL DEFAULT 'gedcom',
  checksum text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  imported_at timestamptz,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE raw_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  import_snapshot_id uuid NOT NULL REFERENCES import_snapshots(id) ON DELETE CASCADE,
  xref text,
  record_type text NOT NULL,
  raw_text text NOT NULL,
  parsed jsonb NOT NULL,
  checksum text NOT NULL,
  UNIQUE (import_snapshot_id, xref)
);

CREATE TABLE people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  primary_xref text,
  display_name text NOT NULL,
  given_name text,
  surname text,
  sex text,
  birth_date text,
  birth_place text,
  death_date text,
  death_place text,
  living_status text NOT NULL DEFAULT 'unknown',
  privacy text NOT NULL DEFAULT 'private',
  confidence numeric(4,3) NOT NULL DEFAULT 0.500,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  primary_xref text,
  spouse_1_id uuid REFERENCES people(id) ON DELETE SET NULL,
  spouse_2_id uuid REFERENCES people(id) ON DELETE SET NULL,
  marriage_date text,
  marriage_place text
);

CREATE TABLE relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  from_person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  to_person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  relationship_type text NOT NULL,
  confidence numeric(4,3) NOT NULL DEFAULT 0.500,
  source_summary text
);

CREATE TABLE places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  original_label text NOT NULL,
  normalized_label text NOT NULL,
  latitude numeric,
  longitude numeric,
  UNIQUE (archive_id, normalized_label)
);

CREATE TABLE facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  person_id uuid REFERENCES people(id) ON DELETE CASCADE,
  family_id uuid REFERENCES families(id) ON DELETE CASCADE,
  fact_type text NOT NULL,
  date_text text,
  place_id uuid REFERENCES places(id) ON DELETE SET NULL,
  value text,
  privacy text NOT NULL DEFAULT 'private',
  confidence numeric(4,3) NOT NULL DEFAULT 0.500,
  raw_record_id uuid REFERENCES raw_records(id) ON DELETE SET NULL
);

CREATE TABLE sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  primary_xref text,
  title text NOT NULL,
  repository text,
  url text,
  ancestry_apid text,
  raw_record_id uuid REFERENCES raw_records(id) ON DELETE SET NULL
);

CREATE TABLE citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  source_id uuid REFERENCES sources(id) ON DELETE SET NULL,
  fact_id uuid REFERENCES facts(id) ON DELETE CASCADE,
  person_id uuid REFERENCES people(id) ON DELETE CASCADE,
  page_text text,
  url text,
  ancestry_apid text,
  evidence_text text,
  confidence numeric(4,3) NOT NULL DEFAULT 0.500
);

CREATE TABLE media_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  primary_xref text,
  title text,
  storage_key text,
  external_url text,
  mime_type text,
  raw_record_id uuid REFERENCES raw_records(id) ON DELETE SET NULL
);

CREATE TABLE research_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  title text NOT NULL,
  question text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  privacy text NOT NULL DEFAULT 'private',
  focus text,
  conclusion text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hypotheses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES research_cases(id) ON DELETE CASCADE,
  statement text NOT NULL,
  confidence numeric(4,3) NOT NULL DEFAULT 0.500,
  status text NOT NULL DEFAULT 'open'
);

CREATE TABLE evidence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES research_cases(id) ON DELETE CASCADE,
  title text NOT NULL,
  evidence_type text NOT NULL,
  summary text NOT NULL,
  source_id uuid REFERENCES sources(id) ON DELETE SET NULL,
  person_id uuid REFERENCES people(id) ON DELETE SET NULL,
  dna_match_id uuid,
  confidence numeric(4,3) NOT NULL DEFAULT 0.500,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES research_cases(id) ON DELETE CASCADE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'todo',
  due_at timestamptz,
  assignee_id uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE dna_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  total_cm numeric(8,2) NOT NULL,
  longest_segment_cm numeric(8,2),
  shared_dna_percent numeric(8,4),
  predicted_relationship text,
  side text CHECK (side IN ('maternal', 'paternal', 'both', 'unknown')),
  tree_status text NOT NULL DEFAULT 'unknown',
  surnames text[] NOT NULL DEFAULT '{}',
  places text[] NOT NULL DEFAULT '{}',
  shared_matches text[] NOT NULL DEFAULT '{}',
  notes text NOT NULL DEFAULT '',
  ancestry_url text,
  helpfulness_score numeric(5,2) NOT NULL DEFAULT 0,
  triage_status text NOT NULL DEFAULT 'needs_review',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dna_hypotheses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dna_match_id uuid NOT NULL REFERENCES dna_matches(id) ON DELETE CASCADE,
  likely_branch text NOT NULL,
  likely_generation text NOT NULL,
  geography text[] NOT NULL DEFAULT '{}',
  candidate_common_ancestors text[] NOT NULL DEFAULT '{}',
  confidence numeric(4,3) NOT NULL,
  explanation text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  uncertainty jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  content text NOT NULL,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id uuid NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  run_type text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_redacted text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX people_archive_name_idx ON people (archive_id, surname, given_name);
CREATE INDEX facts_person_idx ON facts (person_id, fact_type);
CREATE INDEX citations_source_idx ON citations (source_id);
CREATE INDEX cases_archive_status_idx ON research_cases (archive_id, status);
CREATE INDEX dna_archive_score_idx ON dna_matches (archive_id, helpfulness_score DESC);
CREATE INDEX embeddings_archive_entity_idx ON embeddings (archive_id, entity_type, entity_id);

