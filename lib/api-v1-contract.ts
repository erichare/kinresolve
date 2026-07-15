export const apiV1Scopes = [
  "archive:read",
  "cases:read",
  "sources:read",
  "reports:read",
  "archive:export"
] as const;

export type ApiV1Scope = (typeof apiV1Scopes)[number];

export type ApiV1RateLimitProfile = "standard" | "export";

export type ApiV1RouteDefinition = {
  path: string;
  operationId: string;
  scope: ApiV1Scope;
  rateLimitProfile: ApiV1RateLimitProfile;
};

export const apiV1RouteDefinitions = [
  {
    path: "/api/v1/meta",
    operationId: "getMeta",
    scope: "archive:read",
    rateLimitProfile: "standard"
  },
  {
    path: "/api/v1/people",
    operationId: "listPeople",
    scope: "archive:read",
    rateLimitProfile: "standard"
  },
  {
    path: "/api/v1/people/[id]",
    operationId: "getPerson",
    scope: "archive:read",
    rateLimitProfile: "standard"
  },
  {
    path: "/api/v1/sources",
    operationId: "listSources",
    scope: "sources:read",
    rateLimitProfile: "standard"
  },
  {
    path: "/api/v1/cases",
    operationId: "listCases",
    scope: "cases:read",
    rateLimitProfile: "standard"
  },
  {
    path: "/api/v1/reports/quality",
    operationId: "getQualityReport",
    scope: "reports:read",
    rateLimitProfile: "standard"
  },
  {
    path: "/api/v1/exports/gedcom",
    operationId: "exportGedcom",
    scope: "archive:export",
    rateLimitProfile: "export"
  }
] as const satisfies readonly ApiV1RouteDefinition[];

export function isApiV1Scope(value: string): value is ApiV1Scope {
  return (apiV1Scopes as readonly string[]).includes(value);
}

// API resource identifiers are stable, non-content UUID surrogates. Internal
// GEDCOM xrefs and xref-less NAME values never enter API paths or cursors.
export function isApiV1ResourceId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

export function resolveApiV1RouteDefinition(path: string): ApiV1RouteDefinition | null {
  return apiV1RouteDefinitions.find((route) => route.path === path) ?? null;
}
