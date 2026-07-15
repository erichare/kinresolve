import { APP_VERSION } from "./app-version";
import { query, type DatabaseOptions } from "./db";
import {
  encodeApiV1Cursor,
  type ApiV1CursorKey,
  type ApiV1PageRequest
} from "./api-v1-cursor";
import { isApiV1ResourceId } from "./api-v1-contract";

export type ApiV1Page<T> = {
  data: T[];
  page: {
    nextCursor: string | null;
  };
};

export type ApiV1Person = {
  id: string;
  displayName: string;
  givenName?: string;
  surname?: string;
  sex?: "M" | "F" | "U";
  birth: { date?: string; place?: string };
  death: { date?: string; place?: string };
  livingStatus: "living" | "deceased" | "unknown";
  privacy: "public" | "private" | "sensitive";
  updatedAt: string;
};

export type ApiV1PersonDetail = ApiV1Person & {
  facts: Array<{
    id: string;
    type: string;
    date?: string;
    place?: string;
    value?: string;
    privacy?: "public" | "private" | "sensitive";
    confidence: number;
  }>;
  factsTruncated: boolean;
};

export type ApiV1Source = {
  id: string;
  title: string;
  sourceType: string;
  repository?: string;
  citationDate?: string;
  linkedPersonId?: string;
  linkedCaseId?: string;
  privacy: "public" | "private" | "sensitive";
  confidence: number;
  createdAt: string;
};

export type ApiV1Case = {
  id: string;
  title: string;
  question: string;
  status: "active" | "planning" | "paused" | "resolved";
  focus: string;
  privacy: "public" | "private" | "sensitive";
  updatedAt: string;
};

type PersonRow = {
  id: string;
  display_name: string;
  given_name: string | null;
  surname: string | null;
  sex: ApiV1Person["sex"] | null;
  birth_date: string | null;
  birth_place: string | null;
  death_date: string | null;
  death_place: string | null;
  living_status: ApiV1Person["livingStatus"];
  privacy: ApiV1Person["privacy"];
  updated_at: Date;
  sort_order: number;
};

type PersonDetailRow = PersonRow & {
  database_id: string;
};

type SourceRow = {
  id: string;
  title: string;
  source_type: string;
  repository: string | null;
  citation_date: string | null;
  linked_person_id: string | null;
  linked_case_id: string | null;
  privacy: ApiV1Source["privacy"];
  confidence: string | number;
  created_at: Date;
  sort_order: number;
};

type CaseRow = {
  id: string;
  title: string;
  question: string;
  status: ApiV1Case["status"];
  focus: string;
  privacy: ApiV1Case["privacy"];
  updated_at: Date;
  sort_order: number;
};

export async function getApiV1ArchiveMeta(
  archiveId: string,
  options: DatabaseOptions = {}
): Promise<{ id: string; name: string; tagline: string } | null> {
  const result = await query<{ id: string; name: string; tagline: string }>(
    "SELECT api_id::text AS id, name, tagline FROM archives WHERE id = $1 LIMIT 1",
    [archiveId],
    options
  );
  const row = result.rows[0];
  return row ? { ...row, id: requireApiResourceId(row.id) } : null;
}

export function apiV1ProductVersion(): string {
  return APP_VERSION;
}

export async function listApiV1People(
  archiveId: string,
  page: ApiV1PageRequest,
  options: DatabaseOptions = {}
): Promise<ApiV1Page<ApiV1Person>> {
  const rows = await cursorPage<PersonRow>(
    `SELECT person.api_id::text AS id, person.display_name, person.given_name,
       person.surname, person.sex, person.birth_date, person.birth_place,
       person.death_date, person.death_place, person.living_status,
       person.privacy, person.updated_at, person.sort_order
     FROM people AS person
     WHERE person.archive_id = $1`,
    "person",
    archiveId,
    page,
    options
  );
  return projectPage(rows, page.limit, "/api/v1/people", archiveId, mapPerson);
}

export async function getApiV1Person(
  archiveId: string,
  personId: string,
  options: DatabaseOptions = {}
): Promise<ApiV1PersonDetail | null> {
  if (!isApiV1ResourceId(personId)) return null;
  const person = await query<PersonDetailRow>(
    `SELECT person.id AS database_id, person.api_id::text AS id,
       person.display_name, person.given_name, person.surname, person.sex,
       person.birth_date, person.birth_place, person.death_date,
       person.death_place, person.living_status, person.privacy,
       person.updated_at, person.sort_order
     FROM people AS person
     WHERE person.archive_id = $1 AND person.api_id = $2::uuid
     LIMIT 1`,
    [archiveId, personId],
    options
  );
  const row = person.rows[0];
  if (!row) return null;

  const facts = await query<{
    id: string;
    fact_type: string;
    date_text: string | null;
    place_text: string | null;
    value_text: string | null;
    privacy: "public" | "private" | "sensitive" | null;
    confidence: string | number;
  }>(
    `SELECT api_id::text AS id, fact_type, date_text, place_text, value_text, privacy, confidence
     FROM person_facts
     WHERE archive_id = $1 AND person_id = $2
     ORDER BY sort_order ASC, id ASC
     LIMIT 101`,
    [archiveId, row.database_id],
    options
  );

  return {
    ...mapPerson(row),
    facts: facts.rows.slice(0, 100).map((fact) => ({
      id: requireApiResourceId(fact.id),
      type: fact.fact_type,
      ...optional("date", fact.date_text),
      ...optional("place", fact.place_text),
      ...optional("value", fact.value_text),
      ...optional("privacy", fact.privacy),
      confidence: requireApiConfidence(fact.confidence)
    })),
    factsTruncated: facts.rows.length > 100
  };
}

export async function listApiV1Sources(
  archiveId: string,
  page: ApiV1PageRequest,
  options: DatabaseOptions = {}
): Promise<ApiV1Page<ApiV1Source>> {
  const rows = await cursorPage<SourceRow>(
    `SELECT source.api_id::text AS id, source.title, source.source_type,
       source.repository, source.citation_date,
       linked_person.api_id::text AS linked_person_id,
       linked_case.api_id::text AS linked_case_id,
       source.privacy, source.confidence, source.created_at, source.sort_order
     FROM sources AS source
     LEFT JOIN people AS linked_person
       ON linked_person.archive_id = source.archive_id
      AND linked_person.id = source.linked_person_id
     LEFT JOIN research_cases AS linked_case
       ON linked_case.archive_id = source.archive_id
      AND linked_case.id = source.linked_case_id
     WHERE source.archive_id = $1`,
    "source",
    archiveId,
    page,
    options
  );
  return projectPage(rows, page.limit, "/api/v1/sources", archiveId, mapSource);
}

export async function listApiV1Cases(
  archiveId: string,
  page: ApiV1PageRequest,
  options: DatabaseOptions = {}
): Promise<ApiV1Page<ApiV1Case>> {
  const rows = await cursorPage<CaseRow>(
    `SELECT research_case.api_id::text AS id, research_case.title,
       research_case.question, research_case.status, research_case.focus,
       research_case.privacy, research_case.updated_at, research_case.sort_order
     FROM research_cases AS research_case
     WHERE research_case.archive_id = $1`,
    "research_case",
    archiveId,
    page,
    options
  );
  return projectPage(rows, page.limit, "/api/v1/cases", archiveId, mapCase);
}

export async function getApiV1QualityReport(
  archiveId: string,
  options: DatabaseOptions = {},
  now = new Date()
): Promise<{
  generatedAt: string;
  summary: { people: number; sources: number; cases: number; issues: number };
  checks: Array<{ code: string; label: string; count: number; severity: "low" | "medium" | "high" }>;
}> {
  const result = await query<{
    people: number;
    sources: number;
    cases: number;
    public_living_people: number;
    people_without_facts: number;
    unlinked_sources: number;
    cases_without_evidence: number;
    cases_without_hypotheses: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM people WHERE archive_id = $1) AS people,
       (SELECT count(*)::int FROM sources WHERE archive_id = $1) AS sources,
       (SELECT count(*)::int FROM research_cases WHERE archive_id = $1) AS cases,
       (SELECT count(*)::int FROM people
        WHERE archive_id = $1 AND living_status = 'living' AND (privacy = 'public' OR published)) AS public_living_people,
       (SELECT count(*)::int FROM people p
        WHERE p.archive_id = $1 AND NOT EXISTS (
          SELECT 1 FROM person_facts f WHERE f.archive_id = p.archive_id AND f.person_id = p.id
        )) AS people_without_facts,
       (SELECT count(*)::int FROM sources
        WHERE archive_id = $1 AND linked_person_id IS NULL AND linked_case_id IS NULL) AS unlinked_sources,
       (SELECT count(*)::int FROM research_cases c
        WHERE c.archive_id = $1 AND NOT EXISTS (
          SELECT 1 FROM evidence_items e WHERE e.archive_id = c.archive_id AND e.case_id = c.id
        )) AS cases_without_evidence,
       (SELECT count(*)::int FROM research_cases c
        WHERE c.archive_id = $1 AND NOT EXISTS (
          SELECT 1 FROM hypotheses h WHERE h.archive_id = c.archive_id AND h.case_id = c.id
        )) AS cases_without_hypotheses`,
    [archiveId],
    options
  );
  const row = result.rows[0];
  if (!row) throw new Error("Quality report query returned no row");

  const checks = [
    {
      code: "living-person-public",
      label: "Living people marked public or published",
      count: row.public_living_people,
      severity: "high" as const
    },
    {
      code: "people-without-facts",
      label: "People without structured facts",
      count: row.people_without_facts,
      severity: "medium" as const
    },
    {
      code: "unlinked-sources",
      label: "Sources not linked to a person or case",
      count: row.unlinked_sources,
      severity: "low" as const
    },
    {
      code: "cases-without-evidence",
      label: "Cases without evidence",
      count: row.cases_without_evidence,
      severity: "medium" as const
    },
    {
      code: "cases-without-hypotheses",
      label: "Cases without a hypothesis",
      count: row.cases_without_hypotheses,
      severity: "low" as const
    }
  ];

  return {
    generatedAt: now.toISOString(),
    summary: {
      people: row.people,
      sources: row.sources,
      cases: row.cases,
      issues: checks.reduce((total, check) => total + check.count, 0)
    },
    checks
  };
}

async function cursorPage<Row extends { sort_order: number; id: string }>(
  selectSql: string,
  tableAlias: "person" | "source" | "research_case",
  archiveId: string,
  page: ApiV1PageRequest,
  options: DatabaseOptions
): Promise<Row[]> {
  const values: unknown[] = [archiveId];
  let cursorPredicate = "";
  if (page.cursor) {
    values.push(page.cursor.sortOrder, page.cursor.id);
    cursorPredicate = ` AND (${tableAlias}.sort_order > $2
      OR (${tableAlias}.sort_order = $2 AND ${tableAlias}.api_id > $3::uuid))`;
  }
  values.push(page.limit + 1);
  const limitParameter = `$${values.length}`;
  const result = await query<Row>(
    `${selectSql}${cursorPredicate}
     ORDER BY ${tableAlias}.sort_order ASC, ${tableAlias}.api_id ASC
     LIMIT ${limitParameter}`,
    values,
    options
  );
  return result.rows;
}

function projectPage<Row extends { sort_order: number; id: string }, Item>(
  rows: Row[],
  limit: number,
  routeTemplate: string,
  archiveId: string,
  project: (row: Row) => Item
): ApiV1Page<Item> {
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  const nextCursor = rows.length > limit && last
    ? encodeApiV1Cursor(cursorKey(last), routeTemplate, archiveId)
    : null;
  return {
    data: visible.map(project),
    page: { nextCursor }
  };
}

function cursorKey(row: { sort_order: number; id: string }): ApiV1CursorKey {
  return { sortOrder: row.sort_order, id: row.id };
}

function mapPerson(row: PersonRow): ApiV1Person {
  return {
    id: requireApiResourceId(row.id),
    displayName: row.display_name,
    ...optional("givenName", row.given_name),
    ...optional("surname", row.surname),
    ...optional("sex", row.sex),
    birth: {
      ...optional("date", row.birth_date),
      ...optional("place", row.birth_place)
    },
    death: {
      ...optional("date", row.death_date),
      ...optional("place", row.death_place)
    },
    livingStatus: row.living_status,
    privacy: row.privacy,
    updatedAt: row.updated_at.toISOString()
  };
}

function mapSource(row: SourceRow): ApiV1Source {
  return {
    id: requireApiResourceId(row.id),
    title: row.title,
    sourceType: row.source_type,
    ...optional("repository", row.repository),
    ...optional("citationDate", row.citation_date),
    ...optionalResourceId("linkedPersonId", row.linked_person_id),
    ...optionalResourceId("linkedCaseId", row.linked_case_id),
    privacy: row.privacy,
    confidence: requireApiConfidence(row.confidence),
    createdAt: row.created_at.toISOString()
  };
}

function mapCase(row: CaseRow): ApiV1Case {
  return {
    id: requireApiResourceId(row.id),
    title: row.title,
    question: row.question,
    status: row.status,
    focus: row.focus,
    privacy: row.privacy,
    updatedAt: row.updated_at.toISOString()
  };
}

function optional<Key extends string, Value>(
  key: Key,
  value: Value | null | undefined
): Partial<Record<Key, Value>> {
  return value === null || value === undefined ? {} : { [key]: value } as Record<Key, Value>;
}

function optionalResourceId<Key extends string>(
  key: Key,
  value: string | null | undefined
): Partial<Record<Key, string>> {
  return value === null || value === undefined
    ? {}
    : { [key]: requireApiResourceId(value) } as Record<Key, string>;
}

function requireApiResourceId(value: string): string {
  if (!isApiV1ResourceId(value)) {
    throw new Error("The stored API resource identifier is invalid.");
  }
  return value;
}

function requireApiConfidence(value: string | number): number {
  const confidence = Number(value);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("The stored API confidence is invalid.");
  }
  return confidence;
}
