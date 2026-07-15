import SwaggerParser from "@apidevtools/swagger-parser";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { apiV1RouteDefinitions } from "@/lib/api-v1-contract";

type Operation = {
  operationId?: string;
  security?: Array<Record<string, unknown[]>>;
  responses?: Record<string, {
    $ref?: string;
    content?: Record<string, { schema?: { $ref?: string; type?: string } }>;
  }>;
  "x-kinresolve-scope"?: string;
  "x-kinresolve-rate-limit-profile"?: string;
};

type OpenApiDocument = {
  openapi?: string;
  servers?: Array<{ url?: string }>;
  security?: Array<Record<string, unknown[]>>;
  paths?: Record<string, Record<string, Operation | unknown>>;
  components?: {
    responses?: Record<string, {
      headers?: Record<string, unknown>;
    }>;
    schemas?: Record<string, {
      additionalProperties?: boolean;
      required?: string[];
      properties?: Record<string, {
        enum?: string[];
        "x-extensible-enum"?: string[];
      }>;
    }>;
  };
};

const specificationPath = resolve("openapi/kinresolve-v1.yaml");
const source = readFileSync(specificationPath, "utf8");
const httpMethods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

describe("API v1 OpenAPI contract", () => {
  it("is valid OpenAPI 3.1 and exactly matches the GET-only runtime registry", async () => {
    const document = await SwaggerParser.validate(specificationPath) as unknown as OpenApiDocument;
    expect(document.openapi).toBe("3.1.0");
    expect(document.servers).toEqual([{ url: "https://app.kinresolve.com/api/v1", description: "Hosted private beta" }]);
    expect(document.security).toEqual([{ bearerAuth: [] }]);

    const documented = Object.entries(document.paths ?? {}).flatMap(([relativePath, pathItem]) =>
      Object.entries(pathItem)
        .filter(([method]) => httpMethods.has(method.toLowerCase()))
        .map(([method, rawOperation]) => {
          const operation = rawOperation as Operation;
          return {
            method: method.toUpperCase(),
            path: `/api/v1${relativePath}`.replaceAll("{id}", "[id]"),
            operationId: operation.operationId,
            scope: operation["x-kinresolve-scope"],
            rateLimitProfile: operation["x-kinresolve-rate-limit-profile"],
            security: operation.security
          };
        })
    ).sort((left, right) => left.path.localeCompare(right.path));

    const runtime = apiV1RouteDefinitions.map(({ path, operationId, scope, rateLimitProfile }) => ({
      method: "GET",
      path,
      operationId,
      scope,
      rateLimitProfile,
      security: undefined
    })).sort((left, right) => left.path.localeCompare(right.path));

    expect(documented).toEqual(runtime);
    expect(new Set(documented.map((operation) => operation.operationId)).size).toBe(7);
  });

  it("publishes additive response schemas and the stable flat error envelope", async () => {
    const document = await SwaggerParser.parse(specificationPath) as unknown as OpenApiDocument;
    const schemas = document.components?.schemas ?? {};
    const error = schemas.Error;

    expect(error?.additionalProperties).toBe(true);
    expect(error?.required).toEqual(["code", "message", "requestId"]);
    expect(Object.keys(error?.properties ?? {})).toEqual(["code", "message", "requestId"]);
    expect(error?.properties?.code?.enum).toBeUndefined();
    expect(error?.properties?.code?.["x-extensible-enum"]).toEqual([
      "api_disabled",
      "invalid_request",
      "invalid_token",
      "insufficient_scope",
      "not_found",
      "method_not_allowed",
      "rate_limit_exceeded",
      "service_unavailable",
      "internal_error"
    ]);

    for (const schemaName of [
      "Meta",
      "MetaResponse",
      "ArchiveMetadata",
      "Capabilities",
      "PeoplePage",
      "SourcesPage",
      "CasesPage",
      "Page",
      "Person",
      "PersonDetail",
      "PersonDetailResponse",
      "LifeEvent",
      "Fact",
      "Source",
      "Case",
      "QualityReport",
      "QualityReportResponse",
      "QualityCheck"
    ]) {
      expect(schemas[schemaName]?.additionalProperties, schemaName).toBe(true);
    }

    expect(Object.keys(schemas.Person?.properties ?? {})).not.toEqual(
      expect.arrayContaining(["notes", "relatives", "published", "slug"])
    );
    expect(Object.keys(schemas.Source?.properties ?? {})).not.toEqual(
      expect.arrayContaining(["storageKey", "url", "transcript", "notes", "fileName"])
    );
    expect(Object.keys(schemas.Case?.properties ?? {})).not.toEqual(
      expect.arrayContaining(["evidence", "hypotheses", "tasks"])
    );

    const expectedSuccessSchemas = new Map([
      ["/meta", "#/components/schemas/MetaResponse"],
      ["/people", "#/components/schemas/PeoplePage"],
      ["/people/{id}", "#/components/schemas/PersonDetailResponse"],
      ["/sources", "#/components/schemas/SourcesPage"],
      ["/cases", "#/components/schemas/CasesPage"],
      ["/reports/quality", "#/components/schemas/QualityReportResponse"]
    ]);
    for (const [path, schema] of expectedSuccessSchemas) {
      const operation = document.paths?.[path]?.get as Operation;
      expect(operation.responses?.["200"]?.content?.["application/json"]?.schema?.$ref, path).toBe(schema);
      expect(operation.responses?.["404"]?.$ref, path).toBe("#/components/responses/NotFound");
    }
    const exportOperation = document.paths?.["/exports/gedcom"]?.get as Operation;
    expect(exportOperation.responses?.["200"]?.content?.["text/plain"]?.schema?.type).toBe("string");
    expect(exportOperation.responses?.["404"]?.$ref).toBe("#/components/responses/NotFound");

    expect(Object.keys(document.components?.responses?.Forbidden?.headers ?? {})).toEqual([
      "X-Request-Id",
      "Cache-Control",
      "RateLimit-Limit",
      "RateLimit-Remaining",
      "RateLimit-Reset",
      "WWW-Authenticate"
    ]);
  });

  it("uses environment variables in every bearer example and documents the preview boundaries", () => {
    expect(source).toContain("Authorization: Bearer $KINRESOLVE_TOKEN");
    expect(source).not.toMatch(/Authorization:\s*Bearer\s+(?!\$KINRESOLVE_TOKEN)/i);
    expect(source).not.toMatch(/kr_beta_[A-Za-z0-9_-]{12,}/);

    const guide = readFileSync(resolve("docs/api-v1.md"), "utf8");
    const changelog = readFileSync(resolve("docs/api-v1-changelog.md"), "utf8");
    const policy = readFileSync(resolve("docs/api-deprecation-policy.md"), "utf8");
    const edgeChecklist = readFileSync(resolve("docs/api-edge-rate-limit-checklist.md"), "utf8");
    const developersPage = readFileSync(resolve("site/app/developers/page.tsx"), "utf8");

    for (const path of ["/meta", "/people", "/people/{id}", "/sources", "/cases", "/reports/quality", "/exports/gedcom"]) {
      expect(guide, path).toContain(path);
      expect(developersPage, path).toContain(path);
    }
    for (const scope of ["archive:read", "sources:read", "cases:read", "reports:read", "archive:export"]) {
      expect(guide, scope).toContain(scope);
      expect(developersPage, scope).toContain(scope);
    }
    for (const content of [guide, developersPage]) {
      expect(content).toContain("$KINRESOLVE_TOKEN");
      expect(content).not.toMatch(/Bearer\s+kr_beta_[A-Za-z0-9_-]+/i);
      expect(content).toMatch(/60/);
      expect(content).toMatch(/10,000/);
      expect(content).toMatch(/Developer Preview/);
    }
    expect(changelog).toMatch(/Unreleased.*Developer Preview/s);
    expect(changelog).toContain("KINRESOLVE_API_V1_ENABLED=false");
    expect(policy).toMatch(/180 days/);
    expect(policy).toMatch(/Breaking means a new path|new versioned path/i);
    expect(edgeChecklist).toMatch(/required and not yet evidenced/i);
    expect(edgeChecklist).toContain("KINRESOLVE_API_V1_ENABLED=false");
    expect(guide).not.toMatch(/hosted edge independently limits/i);
    expect(guide).toMatch(/non-content UUID surrogates/i);
    expect(changelog).toMatch(/non-content UUID resource surrogates/i);
    expect(developersPage).toMatch(/UUID surrogates.*GEDCOM xrefs/i);
  });
});
