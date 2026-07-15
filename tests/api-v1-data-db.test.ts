import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import SwaggerParser from "@apidevtools/swagger-parser";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDatabasePools } from "@/lib/db";
import { runPendingMigrations } from "@/lib/migrations";

const mocks = vi.hoisted(() => ({
  archiveId: "",
  authenticate: vi.fn()
}));

vi.mock("@/lib/beta-api-tokens", () => ({
  authenticateApiToken: mocks.authenticate
}));

import { GET as getCases } from "@/app/api/v1/cases/route";
import { GET as getMeta } from "@/app/api/v1/meta/route";
import { GET as getPerson } from "@/app/api/v1/people/[id]/route";
import { GET as getPeople } from "@/app/api/v1/people/route";
import { GET as getSources } from "@/app/api/v1/sources/route";

type OpenApiSchema = {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
  additionalProperties?: boolean | OpenApiSchema;
  allOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  oneOf?: OpenApiSchema[];
  not?: OpenApiSchema;
  enum?: unknown[];
  const?: unknown;
  nullable?: boolean;
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  maxProperties?: number;
};

type CollectionBody = {
  data: Array<Record<string, unknown>>;
  page: { nextCursor: string | null };
};

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;
const suffix = randomUUID();
const archiveId = `api-projection-${suffix}`;
const otherArchiveId = `api-projection-other-${suffix}`;
const internalIds = [
  archiveId,
  "@I1@",
  "José /Müller/",
  "@I3@",
  "@F1@",
  "@S1@",
  "@S2@",
  "@C1@",
  "@C2@"
] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalCursorSecret = process.env.KINRESOLVE_API_CURSOR_SECRET;

describeIfDatabase("API v1 database-backed projection contract", () => {
  const pool = new Pool({ connectionString: databaseUrl!, max: 4 });
  let schemas: Record<string, OpenApiSchema>;
  let otherArchivePersonApiId = "";

  beforeAll(async () => {
    await runPendingMigrations(pool);
    process.env.DATABASE_URL = databaseUrl;
    process.env.KINRESOLVE_API_CURSOR_SECRET = "api-projection-cursor-secret-distinct-and-at-least-32-bytes";
    mocks.archiveId = archiveId;
    mocks.authenticate.mockImplementation(async (
      _request: Request,
      input: { requestId: string }
    ) => ({
      ok: true,
      context: {
        tokenId: "11111111-1111-4111-8111-111111111111",
        userId: "api-projection-owner",
        archiveId: mocks.archiveId,
        scopes: ["archive:read", "cases:read", "sources:read", "reports:read", "archive:export"],
        requestId: input.requestId,
        rateLimit: { limit: 60, remaining: 59, reset: 60 }
      }
    }));

    const specification = await SwaggerParser.dereference(
      resolve(process.cwd(), "openapi/kinresolve-v1.yaml")
    ) as unknown as { components?: { schemas?: Record<string, OpenApiSchema> } };
    schemas = specification.components?.schemas ?? {};

    await pool.query(
      `INSERT INTO public.archives (id, name, tagline, slug, dataset_mode)
       VALUES
         ($1, 'Projection archive', 'Private projection fixture', $1, 'pilot'),
         ($2, 'Other projection archive', 'Other private fixture', $2, 'pilot')`,
      [archiveId, otherArchiveId]
    );
    await pool.query(
      `INSERT INTO public.people (
         archive_id, id, slug, display_name, given_name, surname, living_status,
         privacy, sort_order
       )
       VALUES
         ($1, '@I1@', 'xref-person', 'Ada Lovelace', 'Ada', 'Lovelace', 'deceased', 'private', 0),
         ($1, 'José /Müller/', 'xref-less-person', 'José Müller', 'José', 'Müller', 'unknown', 'sensitive', 1),
         ($1, '@I3@', 'third-person', 'Grace Hopper', 'Grace', 'Hopper', 'deceased', 'private', 2),
         ($2, '@I1@', 'other-person', 'Other Archive Person', 'Other', 'Person', 'unknown', 'private', 0)`,
      [archiveId, otherArchiveId]
    );
    await pool.query(
      `INSERT INTO public.person_facts (
         archive_id, id, person_id, fact_type, date_text, place_text, privacy,
         confidence, sort_order
       )
       VALUES ($1, '@F1@', '@I1@', 'BIRT', '1815-12-10', 'London', 'private', 0.875, 0)`,
      [archiveId]
    );
    await pool.query(
      `INSERT INTO public.research_cases (
         archive_id, id, title, question, status, focus, privacy, sort_order
       )
       VALUES
         ($1, '@C1@', 'First case', 'Who was the ancestor?', 'active', 'maternal line', 'private', 0),
         ($1, '@C2@', 'Second case', 'Where did the family live?', 'planning', 'residence', 'sensitive', 1)`,
      [archiveId]
    );
    await pool.query(
      `INSERT INTO public.sources (
         archive_id, id, title, source_type, repository, linked_person_id,
         linked_case_id, privacy, confidence, sort_order
       )
       VALUES
         ($1, '@S1@', 'Birth register', 'Civil record', 'Archive A', '@I1@', '@C1@', 'private', 0.900, 0),
         ($1, '@S2@', 'City directory', 'Directory', 'Archive B', 'José /Müller/', '@C2@', 'sensitive', 0.700, 1)`,
      [archiveId]
    );
    const other = await pool.query<{ api_id: string }>(
      "SELECT api_id::text FROM public.people WHERE archive_id = $1 AND id = '@I1@'",
      [otherArchiveId]
    );
    otherArchivePersonApiId = other.rows[0]!.api_id;
  });

  afterAll(async () => {
    try {
      await pool.query("DELETE FROM public.archives WHERE id = ANY($1::text[])", [
        [archiveId, otherArchiveId]
      ]);
    } finally {
      await closeDatabasePools();
      await pool.end();
      restoreEnvironment("DATABASE_URL", originalDatabaseUrl);
      restoreEnvironment("KINRESOLVE_API_CURSOR_SECRET", originalCursorSecret);
    }
  });

  it("traverses real people, source, and case projections with opaque stable UUIDs", async () => {
    const metaResponse = await getMeta(apiRequest("/api/v1/meta"));
    expect(metaResponse.status).toBe(200);
    const metaBody = await metaResponse.json();
    expectOpenApiShape(metaBody, requiredSchema(schemas, "MetaResponse"));
    expect(metaBody.data.archive.id).toMatch(uuidPattern);

    const people = await traverseCollection(getPeople, "/api/v1/people", requiredSchema(schemas, "PeoplePage"));
    const sources = await traverseCollection(getSources, "/api/v1/sources", requiredSchema(schemas, "SourcesPage"));
    const cases = await traverseCollection(getCases, "/api/v1/cases", requiredSchema(schemas, "CasesPage"));

    expect(people.data).toHaveLength(3);
    expect(sources.data).toHaveLength(2);
    expect(cases.data).toHaveLength(2);
    for (const item of [...people.data, ...sources.data, ...cases.data]) {
      expect(item.id).toMatch(uuidPattern);
    }

    const linkedPerson = people.data.find(({ displayName }) => displayName === "Ada Lovelace")!;
    const linkedCase = cases.data.find(({ title }) => title === "First case")!;
    const linkedSource = sources.data.find(({ title }) => title === "Birth register")!;
    expect(linkedSource).toMatchObject({
      linkedPersonId: linkedPerson.id,
      linkedCaseId: linkedCase.id
    });

    const detailResponse = await getPerson(apiRequest(`/api/v1/people/${linkedPerson.id}`), {
      params: Promise.resolve({ id: String(linkedPerson.id) })
    });
    expect(detailResponse.status).toBe(200);
    const detailBody = await detailResponse.json();
    expectOpenApiShape(detailBody, requiredSchema(schemas, "PersonDetailResponse"));
    expect(detailBody.data.id).toBe(linkedPerson.id);
    expect(detailBody.data.facts).toHaveLength(1);
    expect(detailBody.data.facts[0].id).toMatch(uuidPattern);

    const serialized = JSON.stringify({ metaBody, people, sources, cases, detailBody });
    for (const internalId of internalIds) expect(serialized).not.toContain(internalId);
    expect(serialized).not.toMatch(/"(?:archiveId|databaseId|importId|personId|rawRecordId|sortOrder|userId)"/);
  });

  it("denies raw and cross-archive identifiers through the real detail query", async () => {
    for (const id of ["@I1@", "José /Müller/", otherArchivePersonApiId]) {
      const response = await getPerson(apiRequest(`/api/v1/people/${encodeURIComponent(id)}`), {
        params: Promise.resolve({ id })
      });
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ code: "not_found" });
    }
  });

  it("enforces the public confidence range on new fact and source writes", async () => {
    await expect(pool.query(
      `UPDATE public.person_facts
       SET confidence = 1.001
       WHERE archive_id = $1 AND id = '@F1@'`,
      [archiveId]
    )).rejects.toThrow(/person_facts_api_confidence_range/i);
    await expect(pool.query(
      `UPDATE public.sources
       SET confidence = -0.001
       WHERE archive_id = $1 AND id = '@S1@'`,
      [archiveId]
    )).rejects.toThrow(/sources_api_confidence_range/i);
  });
});

async function traverseCollection(
  get: (request: Request) => Promise<Response>,
  path: string,
  schema: OpenApiSchema
): Promise<{ data: Array<Record<string, unknown>>; cursors: string[] }> {
  const data: Array<Record<string, unknown>> = [];
  const cursors: string[] = [];
  let cursor: string | null = null;
  do {
    const search = new URLSearchParams({ limit: "1" });
    if (cursor) search.set("cursor", cursor);
    const response = await get(apiRequest(`${path}?${search}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("ratelimit-limit")).toBe("60");
    const body = await response.json() as CollectionBody;
    expectOpenApiShape(body, schema);
    data.push(...body.data);
    cursor = body.page.nextCursor;
    if (cursor) {
      cursors.push(cursor);
      const payload = Buffer.from(cursor.split(".")[0]!, "base64url").toString("utf8");
      for (const internalId of internalIds) expect(payload).not.toContain(internalId);
    }
  } while (cursor);
  expect(cursors.length).toBeGreaterThan(0);
  return { data, cursors };
}

function apiRequest(path: string): Request {
  return new Request(new URL(path, "https://app.kinresolve.com"), {
    headers: { authorization: "Bearer test-auth-is-mocked" }
  });
}

function requiredSchema(schemas: Record<string, OpenApiSchema>, name: string): OpenApiSchema {
  const schema = schemas[name];
  if (!schema) throw new Error(`OpenAPI schema ${name} is missing.`);
  return schema;
}

function expectOpenApiShape(value: unknown, schema: OpenApiSchema): void {
  const errors = openApiValidationErrors(value, schema, "$", new Set());
  expect(errors, errors.join("\n")).toEqual([]);
}

function openApiValidationErrors(
  value: unknown,
  schema: OpenApiSchema,
  path: string,
  active: Set<OpenApiSchema>
): string[] {
  if (active.has(schema)) return [];
  const nextActive = new Set(active).add(schema);
  const errors: string[] = [];

  for (const branch of schema.allOf ?? []) {
    errors.push(...openApiValidationErrors(value, branch, path, nextActive));
  }
  if (schema.anyOf?.length) {
    const validBranches = schema.anyOf.filter(
      (branch) => openApiValidationErrors(value, branch, path, nextActive).length === 0
    );
    if (validBranches.length === 0) errors.push(`${path} does not match any anyOf branch`);
  }
  if (schema.oneOf?.length) {
    const validBranches = schema.oneOf.filter(
      (branch) => openApiValidationErrors(value, branch, path, nextActive).length === 0
    );
    if (validBranches.length !== 1) {
      errors.push(`${path} matches ${validBranches.length} oneOf branches instead of exactly one`);
    }
  }
  if (schema.not && openApiValidationErrors(value, schema.not, path, nextActive).length === 0) {
    errors.push(`${path} matches its forbidden schema`);
  }

  if ("const" in schema && !jsonValuesEqual(value, schema.const)) {
    errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((candidate) => jsonValuesEqual(value, candidate))) {
    errors.push(`${path} must be one of ${JSON.stringify(schema.enum)}`);
  }

  if (value === null && schema.nullable) return errors;
  const declaredTypes = schema.type
    ? (Array.isArray(schema.type) ? schema.type : [schema.type])
    : [];
  if (declaredTypes.length > 0 && !declaredTypes.some((type) => matchesJsonType(value, type))) {
    errors.push(`${path} must be ${declaredTypes.join(" or ")}, received ${jsonType(value)}`);
    return errors;
  }

  if (typeof value === "string") {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) {
      errors.push(`${path} must contain at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && length > schema.maxLength) {
      errors.push(`${path} must contain at most ${schema.maxLength} characters`);
    }
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) {
      errors.push(`${path} must match /${schema.pattern}/u`);
    }
    if (schema.format && !matchesFormat(value, schema.format)) {
      errors.push(`${path} must match the ${schema.format} format`);
    }
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) errors.push(`${path} must be finite`);
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path} must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path} must be <= ${schema.maximum}`);
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      errors.push(`${path} must be > ${schema.exclusiveMinimum}`);
    }
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
      errors.push(`${path} must be < ${schema.exclusiveMaximum}`);
    }
    if (schema.multipleOf !== undefined) {
      const quotient = value / schema.multipleOf;
      if (Math.abs(quotient - Math.round(quotient)) > Number.EPSILON * 16) {
        errors.push(`${path} must be a multiple of ${schema.multipleOf}`);
      }
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path} must contain at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path} must contain at most ${schema.maxItems} items`);
    }
    if (schema.uniqueItems) {
      const unique = new Set(value.map((item) => JSON.stringify(item)));
      if (unique.size !== value.length) errors.push(`${path} must contain unique items`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...openApiValidationErrors(item, schema.items!, `${path}[${index}]`, nextActive));
      });
    }
  }

  if (isJsonObject(value)) {
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
      errors.push(`${path} must contain at least ${schema.minProperties} properties`);
    }
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) {
      errors.push(`${path} must contain at most ${schema.maxProperties} properties`);
    }
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) errors.push(`${path}.${required} is required`);
    }
    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, name)) {
        errors.push(...openApiValidationErrors(value[name], property, `${path}.${name}`, nextActive));
      }
    }
    const knownProperties = new Set(Object.keys(schema.properties ?? {}));
    for (const name of keys.filter((key) => !knownProperties.has(key))) {
      if (schema.additionalProperties === false) {
        errors.push(`${path}.${name} is not allowed`);
      } else if (typeof schema.additionalProperties === "object") {
        errors.push(...openApiValidationErrors(
          value[name],
          schema.additionalProperties,
          `${path}.${name}`,
          nextActive
        ));
      }
    }
  }

  return errors;
}

function matchesJsonType(value: unknown, type: string): boolean {
  switch (type) {
    case "null": return value === null;
    case "array": return Array.isArray(value);
    case "object": return isJsonObject(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "string": return typeof value === "string";
    case "boolean": return typeof value === "boolean";
    default: throw new Error(`Unsupported OpenAPI schema type: ${type}`);
  }
}

function matchesFormat(value: string, format: string): boolean {
  switch (format) {
    case "uuid":
      return uuidPattern.test(value);
    case "date-time":
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
        && Number.isFinite(Date.parse(value));
    default:
      throw new Error(`Unsupported OpenAPI string format: ${format}`);
  }
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  return typeof value;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
