import { beforeEach, describe, expect, it, vi } from "vitest";

const tokenMocks = vi.hoisted(() => ({
  authenticateApiToken: vi.fn(),
  recordApiTokenExportUse: vi.fn()
}));
const dataMocks = vi.hoisted(() => ({
  apiV1ProductVersion: vi.fn(),
  getApiV1ArchiveMeta: vi.fn(),
  getApiV1Person: vi.fn(),
  getApiV1QualityReport: vi.fn(),
  listApiV1Cases: vi.fn(),
  listApiV1People: vi.fn(),
  listApiV1Sources: vi.fn()
}));
const workspaceMocks = vi.hoisted(() => ({ readWorkspace: vi.fn() }));
const exporterMocks = vi.hoisted(() => ({ exportGedcom: vi.fn() }));
const observabilityMocks = vi.hoisted(() => ({
  captureOperationalError: vi.fn(),
  emitOperationalEvent: vi.fn()
}));

vi.mock("@/lib/beta-api-tokens", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/beta-api-tokens")>()),
  ...tokenMocks
}));
vi.mock("@/lib/api-v1-data", () => dataMocks);
vi.mock("@/lib/workspace-store", () => workspaceMocks);
vi.mock("@/lib/gedcom/exporter", () => exporterMocks);
vi.mock("@/lib/observability", () => observabilityMocks);

import { GET as GET_CASES } from "@/app/api/v1/cases/route";
import { GET as GET_EXPORT } from "@/app/api/v1/exports/gedcom/route";
import { GET as GET_META } from "@/app/api/v1/meta/route";
import { GET as GET_PERSON } from "@/app/api/v1/people/[id]/route";
import { GET as GET_PEOPLE } from "@/app/api/v1/people/route";
import { GET as GET_QUALITY } from "@/app/api/v1/reports/quality/route";
import { GET as GET_SOURCES } from "@/app/api/v1/sources/route";

const requestId = "54c929e1-c30d-4d54-bce0-44bb57007fed";
const tokenId = "a4a17f15-b49a-4c42-872f-a76f38ad23ac";
const archiveApiId = "11111111-1111-4111-8111-111111111111";
const personApiId = "22222222-2222-4222-8222-222222222222";
const scopes = [
  "archive:read",
  "sources:read",
  "cases:read",
  "reports:read",
  "archive:export"
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.KINRESOLVE_API_CURSOR_SECRET = "cursor-secret-with-at-least-thirty-two-private-bytes";
  tokenMocks.authenticateApiToken.mockImplementation(async (
    _request: Request,
    input: { requestId: string }
  ) => ({
    ok: true,
    context: {
      tokenId,
      userId: "owner-1",
      archiveId: "archive-private",
      scopes: [...scopes],
      requestId: input.requestId,
      rateLimit: { limit: 60, remaining: 59, reset: 42 }
    }
  }));
  tokenMocks.recordApiTokenExportUse.mockResolvedValue(undefined);
  dataMocks.apiV1ProductVersion.mockReturnValue("0.18.0");
  dataMocks.getApiV1ArchiveMeta.mockResolvedValue({
    id: archiveApiId,
    name: "Private Archive",
    tagline: "Private research"
  });
  dataMocks.getApiV1Person.mockResolvedValue(null);
  dataMocks.getApiV1QualityReport.mockResolvedValue({
    generatedAt: "2026-07-15T00:00:00.000Z",
    summary: { people: 0, sources: 0, cases: 0, issues: 0 },
    checks: []
  });
  for (const mock of [dataMocks.listApiV1Cases, dataMocks.listApiV1People, dataMocks.listApiV1Sources]) {
    mock.mockResolvedValue({ data: [], page: { nextCursor: null } });
  }
  workspaceMocks.readWorkspace.mockResolvedValue({
    archiveName: "Private Archive",
    people: [],
    rawRecords: [],
    imports: []
  });
  exporterMocks.exportGedcom.mockReturnValue({ fileName: "private-archive.ged", content: "0 HEAD\n0 TRLR\n" });
  observabilityMocks.captureOperationalError.mockResolvedValue({});
  observabilityMocks.emitOperationalEvent.mockResolvedValue({});
});

describe("API v1 routes", () => {
  it("returns archive metadata and token-specific capability flags", async () => {
    const response = await GET_META(apiRequest("/api/v1/meta"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: {
      apiVersion: "v1",
      productVersion: "0.18.0",
      archive: { id: archiveApiId, name: "Private Archive", tagline: "Private research" },
      capabilities: {
        people: true,
        sources: true,
        cases: true,
        qualityReport: true,
        gedcomExport: true
      }
    } });
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(tokenMocks.authenticateApiToken.mock.calls[0][1].requestId)
      .toBe(response.headers.get("x-request-id"));
    expect(response.headers.get("ratelimit-remaining")).toBe("59");
  });

  it("returns the same stable denial before any archive query", async () => {
    tokenMocks.authenticateApiToken.mockResolvedValue({
      ok: false,
      status: 401,
      code: "invalid_token",
      message: "The bearer token is invalid, expired, or revoked.",
      requestId
    });

    const response = await GET_PEOPLE(apiRequest("/api/v1/people", "bad"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_token",
      message: "The bearer token is invalid, expired, or revoked.",
      requestId
    });
    expect(dataMocks.listApiV1People).not.toHaveBeenCalled();
  });

  it("rejects non-contract query parameters and keeps list reads archive-bound", async () => {
    const invalid = await GET_PEOPLE(apiRequest("/api/v1/people?query=private-name"));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      code: "invalid_request",
      requestId: expect.any(String)
    });

    const valid = await GET_PEOPLE(apiRequest("/api/v1/people?limit=10"));
    expect(valid.status).toBe(200);
    expect(dataMocks.listApiV1People).toHaveBeenCalledWith(
      "archive-private",
      { limit: 10, cursor: null }
    );
  });

  it("never reflects a caller-controlled query key in errors or telemetry", async () => {
    const privateMarker = "Private Person Müller";
    const response = await GET_PEOPLE(apiRequest(
      `/api/v1/people?${encodeURIComponent(privateMarker)}=1`
    ));
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(400);
    expect(body).not.toContain(privateMarker);
    expect([...response.headers].join("\n")).not.toContain(privateMarker);
    expect(JSON.stringify(observabilityMocks.emitOperationalEvent.mock.calls)).not.toContain(privateMarker);
  });

  it("uses a private 404 for missing and internal person ids", async () => {
    for (const id of [
      "33333333-3333-4333-8333-333333333333",
      "@I1@",
      "José /Müller/"
    ]) {
      const response = await GET_PERSON(
        apiRequest(`/api/v1/people/${encodeURIComponent(id)}`),
        { params: Promise.resolve({ id }) }
      );
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        code: "not_found",
        requestId: expect.any(String)
      });
    }
  });

  it("addresses person detail only through the non-content API surrogate", async () => {
    dataMocks.getApiV1Person.mockResolvedValue({ id: personApiId });

    const response = await GET_PERSON(
      apiRequest(`/api/v1/people/${personApiId}`),
      { params: Promise.resolve({ id: personApiId }) }
    );

    expect(response.status).toBe(200);
    expect(dataMocks.getApiV1Person).toHaveBeenCalledWith("archive-private", personApiId);
    expect(response.url).not.toMatch(/I1|Müller/);
  });

  it("wires every remaining read route to its exact archive-scoped service", async () => {
    expect((await GET_SOURCES(apiRequest("/api/v1/sources"))).status).toBe(200);
    expect((await GET_CASES(apiRequest("/api/v1/cases"))).status).toBe(200);
    expect((await GET_QUALITY(apiRequest("/api/v1/reports/quality"))).status).toBe(200);

    expect(dataMocks.listApiV1Sources).toHaveBeenCalledWith(
      "archive-private",
      { limit: 25, cursor: null }
    );
    expect(dataMocks.listApiV1Cases).toHaveBeenCalledWith(
      "archive-private",
      { limit: 25, cursor: null }
    );
    expect(dataMocks.getApiV1QualityReport).toHaveBeenCalledWith("archive-private");
  });

  it("binds GEDCOM export and its high-sensitivity audit to the authorized archive", async () => {
    const response = await GET_EXPORT(apiRequest("/api/v1/exports/gedcom"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("private-archive.ged");
    expect(workspaceMocks.readWorkspace).toHaveBeenCalledWith({ archiveId: "archive-private" });
    expect(tokenMocks.recordApiTokenExportUse).toHaveBeenCalledWith({
      tokenId,
      archiveId: "archive-private",
      userId: "owner-1",
      requestId: expect.any(String),
      routeTemplate: "/api/v1/exports/gedcom"
    });
  });

  it("returns the exhausted durable bucket and Retry-After on 429", async () => {
    tokenMocks.authenticateApiToken.mockResolvedValue({
      ok: false,
      status: 429,
      code: "rate_limit_exceeded",
      message: "The API rate limit has been exceeded.",
      requestId,
      rateLimit: { limit: 60, remaining: 0, reset: 17, retryAfter: 17 }
    });

    const response = await GET_META(apiRequest("/api/v1/meta"));

    expect(response.status).toBe(429);
    expect(response.headers.get("ratelimit-remaining")).toBe("0");
    expect(response.headers.get("retry-after")).toBe("17");
  });
});

function apiRequest(path: string, token = `kr_beta_${"a".repeat(43)}`): Request {
  return new Request(`https://app.kinresolve.com${path}`, {
    headers: { authorization: `Bearer ${token}` }
  });
}
