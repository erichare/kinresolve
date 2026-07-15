import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSessionContext: vi.fn()
}));
const dbMocks = vi.hoisted(() => ({
  ensureDatabaseSchema: vi.fn().mockResolvedValue(undefined)
}));
const releaseFenceMocks = vi.hoisted(() => ({
  getActiveReleaseFence: vi.fn().mockResolvedValue(null)
}));

vi.mock("@/lib/auth-session", () => ({
  getSessionContext: authMocks.getSessionContext
}));
vi.mock("@/lib/db", () => ({
  ensureDatabaseSchema: dbMocks.ensureDatabaseSchema
}));
vi.mock("@/lib/release-fence", () => ({
  getActiveReleaseFence: releaseFenceMocks.getActiveReleaseFence
}));

import { proxy } from "@/proxy";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  releaseFenceMocks.getActiveReleaseFence.mockResolvedValue(null);
});

const memberContext = { userId: "u1", email: "a@b.c", name: "A", role: "owner" as const, archiveId: "archive-default" };

describe("private workspace proxy", () => {
  it.each([
    ["product POST", "/api/cases", "POST"],
    ["product PATCH", "/api/settings/archive", "PATCH"],
    ["product DELETE", "/api/integrations/integration-1", "DELETE"],
    ["Better Auth POST", "/api/auth/sign-in/email", "POST"],
    ["logout POST", "/api/auth/logout", "POST"],
    ["bootstrap POST", "/api/setup/claim", "POST"]
  ])("blocks a %s with the durable release fence before route handling", async (_label, pathname, method) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    vi.stubEnv("APP_BASE_URL", "https://app.kinresolve.com");
    releaseFenceMocks.getActiveReleaseFence.mockResolvedValue({
      fenceId: "fence-private-beta-01",
      releaseCommitSha: "a".repeat(40),
      state: "active",
      activationGeneration: 1,
      firstActivatedAt: "2026-07-15T06:00:00.000Z",
      activatedAt: "2026-07-15T06:00:00.000Z",
      releasedAt: null,
      updatedAt: "2026-07-15T06:00:00.000Z"
    });

    const response = await proxy(new NextRequest(`https://app.kinresolve.com${pathname}`, {
      method,
      headers: {
        origin: "https://app.kinresolve.com",
        "sec-fetch-site": "same-origin"
      }
    }));

    expect(response.status).toBe(423);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    await expect(response.json()).resolves.toEqual({
      error: "Writes are temporarily paused for release safety"
    });
    expect(dbMocks.ensureDatabaseSchema).not.toHaveBeenCalled();
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it.each([
    ["health", "/api/health", "GET"],
    ["private reads", "/api/people", "GET"],
    ["authenticated integration cron", "/api/cron/integration-jobs", "GET"],
    ["authenticated upload cleanup cron", "/api/cron/import-uploads", "GET"],
    ["fence acquire", "/api/release/fence/acquire", "POST"],
    ["fence assert", "/api/release/fence/assert", "POST"],
    ["fence reacquire", "/api/release/fence/reacquire", "POST"],
    ["fence release", "/api/release/fence/release", "POST"]
  ])("does not block %s through the mutation fence", async (_label, pathname, method) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    vi.stubEnv("APP_BASE_URL", "https://app.kinresolve.com");
    authMocks.getSessionContext.mockResolvedValue(memberContext);
    releaseFenceMocks.getActiveReleaseFence.mockResolvedValue({
      fenceId: "fence-private-beta-01",
      releaseCommitSha: "a".repeat(40),
      state: "active",
      activationGeneration: 1,
      firstActivatedAt: "2026-07-15T06:00:00.000Z",
      activatedAt: "2026-07-15T06:00:00.000Z",
      releasedAt: null,
      updatedAt: "2026-07-15T06:00:00.000Z"
    });

    const response = await proxy(new NextRequest(`https://app.kinresolve.com${pathname}`, {
      method,
      headers: {
        origin: "https://app.kinresolve.com",
        "sec-fetch-site": "same-origin"
      }
    }));

    expect(response.status).toBe(200);
    expect(releaseFenceMocks.getActiveReleaseFence).not.toHaveBeenCalled();
  });

  it("fails closed when the durable release-fence check is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    vi.stubEnv("APP_BASE_URL", "https://app.kinresolve.com");
    releaseFenceMocks.getActiveReleaseFence.mockRejectedValue(new Error("database unavailable"));

    const response = await proxy(new NextRequest("https://app.kinresolve.com/api/cases", {
      method: "POST",
      headers: {
        origin: "https://app.kinresolve.com",
        "sec-fetch-site": "same-origin"
      }
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Release write safety check unavailable" });
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it.each([
    ["permission POST mutation", "/api/cases", "POST"],
    ["permission PATCH mutation", "/api/settings/archive", "PATCH"],
    ["permission DELETE mutation", "/api/integrations/integration-1", "DELETE"],
    ["logout mutation", "/api/auth/logout", "POST"],
    ["bootstrap mutation", "/api/setup/claim", "POST"]
  ])("rejects a %s without same-origin request metadata before database access", async (_label, pathname, method) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    vi.stubEnv("APP_BASE_URL", "https://app.kinresolve.com");

    // Intentionally omit Cookie as well as Origin/Sec-Fetch-Site. The request
    // policy protects the cookie-capable endpoint, not only requests that
    // happen to arrive with a cookie header.
    const response = await proxy(new NextRequest(`https://app.kinresolve.com${pathname}`, { method }));

    expect(response.status).toBe(403);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
    expect(dbMocks.ensureDatabaseSchema).not.toHaveBeenCalled();
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, "same-origin"],
    ["https://evil.example", "same-origin"],
    ["https://app.kinresolve.com", undefined],
    ["https://app.kinresolve.com", "same-site"],
    ["https://app.kinresolve.com", "cross-site"]
  ])("rejects Origin %s and Sec-Fetch-Site %s before database access", async (origin, fetchSite) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    vi.stubEnv("APP_BASE_URL", "https://app.kinresolve.com");
    const headers = new Headers();
    if (origin) headers.set("origin", origin);
    if (fetchSite) headers.set("sec-fetch-site", fetchSite);

    const response = await proxy(new NextRequest("https://app.kinresolve.com/api/cases", {
      method: "POST",
      headers
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
    expect(dbMocks.ensureDatabaseSchema).not.toHaveBeenCalled();
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["not a URL", "not-a-url"],
    ["non-HTTPS", "http://app.kinresolve.com"],
    ["non-origin URL", "https://app.kinresolve.com/private"]
  ])("fails closed when the production application origin is %s", async (_label, appBaseUrl) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    if (appBaseUrl !== undefined) vi.stubEnv("APP_BASE_URL", appBaseUrl);

    const response = await proxy(new NextRequest("https://app.kinresolve.com/api/cases", {
      method: "POST",
      headers: {
        origin: "https://app.kinresolve.com",
        "sec-fetch-site": "same-origin"
      }
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    await expect(response.json()).resolves.toEqual({
      error: "Application request origin is not configured"
    });
    expect(dbMocks.ensureDatabaseSchema).not.toHaveBeenCalled();
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it("allows an exact same-origin mutation to proceed to the membership gate", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    vi.stubEnv("APP_BASE_URL", "https://app.kinresolve.com");
    authMocks.getSessionContext.mockResolvedValue(memberContext);

    const response = await proxy(new NextRequest("https://app.kinresolve.com/api/cases", {
      method: "POST",
      headers: {
        origin: "https://app.kinresolve.com",
        "sec-fetch-site": "same-origin"
      }
    }));

    expect(response.status).toBe(200);
    expect(dbMocks.ensureDatabaseSchema).toHaveBeenCalledOnce();
    expect(authMocks.getSessionContext).toHaveBeenCalledOnce();
  });

  it.each([
    ["Better Auth", "/api/auth/sign-in/email", "POST"],
    ["service bearer cron", "/api/cron/import-uploads", "GET"]
  ])("leaves %s request-origin enforcement to its dedicated policy", async (_label, pathname, method) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");

    const response = await proxy(new NextRequest(`https://preview.example${pathname}`, { method }));

    expect(response.status).toBe(200);
    expect(dbMocks.ensureDatabaseSchema).not.toHaveBeenCalled();
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it.each(["/", "/people", "/people/ada", "/places", "/stories", "/kinsleuth"])(
    "redirects the disabled hosted public archive route %s before database access",
    async (pathname) => {
      stubPrivateHostedEnvironment();
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
      vi.stubEnv("APP_BASE_URL", "https://app.kinresolve.com");

      const response = await proxy(new NextRequest(`https://preview.example${pathname}`));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("https://app.kinresolve.com/login?next=%2Fapp");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
      expect(authMocks.getSessionContext).not.toHaveBeenCalled();
    }
  );

  it("keeps the static challenge and self-hosted public archive reachable", async () => {
    stubPrivateHostedEnvironment();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");

    expect((await proxy(new NextRequest("https://kinsleuth.example/challenge"))).status).toBe(200);

    vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "self-hosted");
    vi.stubEnv("KINRESOLVE_PUBLIC_ARCHIVE_ENABLED", "true");
    expect((await proxy(new NextRequest("https://kinsleuth.example/people"))).status).toBe(200);
    expect((await proxy(new NextRequest("https://kinsleuth.example/peopleish"))).status).toBe(200);
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it.each(["/app/dna", "/app/dna/future"])(
    "returns an exact non-indexable 404 for the disabled DNA page %s before authentication",
    async (pathname) => {
      stubPrivateHostedEnvironment();
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AUTH_SECRET", "a-long-production-secret");

      const response = await proxy(new NextRequest(`https://app.kinresolve.com${pathname}`));

      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
      await expect(response.text()).resolves.toBe("Not found");
      expect(dbMocks.ensureDatabaseSchema).not.toHaveBeenCalled();
      expect(authMocks.getSessionContext).not.toHaveBeenCalled();
    }
  );

  it("fails closed before DNA page authentication when hosted capability configuration is invalid", async () => {
    stubPrivateHostedEnvironment();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    vi.stubEnv("KINRESOLVE_DNA_ENABLED", "invalid");

    const response = await proxy(new NextRequest("https://app.kinresolve.com/app/dna"));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(dbMocks.ensureDatabaseSchema).not.toHaveBeenCalled();
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it("fails closed when production authentication is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "");

    const response = await proxy(new NextRequest("https://kinsleuth.example/app"));

    expect(response.status).toBe(503);
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated production users to login", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    authMocks.getSessionContext.mockResolvedValue(null);

    const response = await proxy(new NextRequest("https://kinsleuth.example/app/cases?view=open"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://kinsleuth.example/login?next=%2Fapp%2Fcases%3Fview%3Dopen");
  });

  it("uses the canonical application origin for production login redirects", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    vi.stubEnv("APP_BASE_URL", "https://app.kinresolve.com");
    authMocks.getSessionContext.mockResolvedValue(null);

    const response = await proxy(new NextRequest("https://kinresolve-release.vercel.app/app"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.kinresolve.com/login?next=%2Fapp");
  });

  it("returns an API error instead of redirecting", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    authMocks.getSessionContext.mockResolvedValue(null);

    const response = await proxy(new NextRequest("https://kinsleuth.example/api/people"));

    expect(response.status).toBe(401);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required" });
  });

  it("lets a session WITH archive membership through", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    authMocks.getSessionContext.mockResolvedValue(memberContext);

    const response = await proxy(new NextRequest("https://kinsleuth.example/api/people"));

    expect(response.status).toBe(200);
  });

  it("rejects an authenticated session that has no membership", async () => {
    // getSessionContext returns null for accounts with no archive membership,
    // so a membership-less signup cannot reach private data.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    authMocks.getSessionContext.mockResolvedValue(null);

    const response = await proxy(new NextRequest("https://kinsleuth.example/api/people"));

    expect(response.status).toBe(401);
  });

  it("protects the settings API", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    vi.stubEnv("APP_BASE_URL", "https://app.kinresolve.com");
    authMocks.getSessionContext.mockResolvedValue(null);

    const response = await proxy(new NextRequest("https://app.kinresolve.com/api/settings/archive", {
      method: "PATCH",
      headers: {
        origin: "https://app.kinresolve.com",
        "sec-fetch-site": "same-origin"
      }
    }));

    expect(response.status).toBe(401);
  });

  it("protects the GEDCOM export API", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    authMocks.getSessionContext.mockResolvedValue(null);

    const response = await proxy(new NextRequest("https://kinsleuth.example/api/exports/gedcom"));

    expect(response.status).toBe(401);
  });

  it("fails closed for unregistered future API routes, even for members", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    authMocks.getSessionContext.mockResolvedValue(memberContext);

    const response = await proxy(new NextRequest("https://kinsleuth.example/api/future-private-feature"));

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expect(dbMocks.ensureDatabaseSchema).not.toHaveBeenCalled();
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it("returns 405 for unsupported methods on registered routes without membership checks", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");

    for (const [url, method, allow] of [
      ["https://kinsleuth.example/api/health", "POST", "GET, HEAD"],
      ["https://kinsleuth.example/api/auth/logout", "GET", "POST"]
    ] as const) {
      const response = await proxy(new NextRequest(url, { method }));
      expect(response.status, `${method} ${url}`).toBe(405);
      expect(response.headers.get("allow"), `${method} ${url}`).toBe(allow);
      expect(response.headers.get("x-request-id"), `${method} ${url}`).toMatch(/^[0-9a-f-]{36}$/);
    }

    expect(dbMocks.ensureDatabaseSchema).not.toHaveBeenCalled();
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it("passes registered bearer-only API v1 reads without cookie-session fallback", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    authMocks.getSessionContext.mockResolvedValue(memberContext);

    const response = await proxy(new NextRequest("https://app.kinresolve.com/api/v1/people", {
      headers: { authorization: `Bearer kr_beta_${"a".repeat(43)}` }
    }));

    expect(response.status).toBe(200);
    expect(dbMocks.ensureDatabaseSchema).not.toHaveBeenCalled();
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it("keeps unknown routes and every non-GET API v1 method on the flat external error contract", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");

    const missing = await proxy(new NextRequest("https://app.kinresolve.com/api/v1/future"));
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      code: "not_found",
      message: "Not found",
      requestId: expect.any(String)
    });

    for (const method of ["POST", "HEAD", "OPTIONS"] as const) {
      const response = await proxy(new NextRequest("https://app.kinresolve.com/api/v1/meta", { method }));
      expect(response.status, method).toBe(405);
      expect(response.headers.get("allow"), method).toBe("GET");
      expect(response.headers.get("vary"), method).toContain("Authorization");
      expect(response.headers.get("access-control-allow-origin"), method).toBeNull();
      await expect(response.json()).resolves.toEqual({
        code: "method_not_allowed",
        message: "Method not allowed",
        requestId: expect.any(String)
      });
    }

    expect(dbMocks.ensureDatabaseSchema).not.toHaveBeenCalled();
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it("returns an explicit 503 for auth and bootstrap APIs when production auth is unconfigured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("APP_BASE_URL", "https://kinsleuth.example");

    for (const [url, method, headers] of [
      ["https://kinsleuth.example/api/auth/session", "GET", undefined],
      ["https://kinsleuth.example/api/setup/claim", "POST", {
        origin: "https://kinsleuth.example",
        "sec-fetch-site": "same-origin"
      }]
    ] as const) {
      const response = await proxy(new NextRequest(url, { method, headers }));
      expect(response.status, `${method} ${url}`).toBe(503);
      expect(response.headers.get("x-request-id"), `${method} ${url}`).toMatch(/^[0-9a-f-]{36}$/);
      await expect(response.json()).resolves.toEqual({
        error: "Private workspace authentication is not configured"
      });
    }

    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it("keeps health, service-authenticated cron, and logout reachable without production auth configuration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("APP_BASE_URL", "https://kinsleuth.example");

    for (const [url, method, headers] of [
      ["https://kinsleuth.example/api/health", "GET", undefined],
      ["https://kinsleuth.example/api/cron/import-uploads", "GET", undefined],
      ["https://kinsleuth.example/api/auth/logout", "POST", {
        origin: "https://kinsleuth.example",
        "sec-fetch-site": "same-origin"
      }]
    ] as const) {
      const response = await proxy(new NextRequest(url, { method, headers }));
      expect(response.status, `${method} ${url}`).toBe(200);
    }

    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it("does not membership-gate public, bootstrap, or service-authenticated APIs", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
    vi.stubEnv("APP_BASE_URL", "https://kinsleuth.example");
    authMocks.getSessionContext.mockResolvedValue(null);

    for (const [url, method, headers] of [
      ["https://kinsleuth.example/api/health", "GET", undefined],
      ["https://kinsleuth.example/api/auth/session", "GET", undefined],
      ["https://kinsleuth.example/api/setup/claim", "POST", {
        origin: "https://kinsleuth.example",
        "sec-fetch-site": "same-origin"
      }],
      ["https://kinsleuth.example/api/cron/import-uploads", "GET", undefined]
    ] as const) {
      const response = await proxy(new NextRequest(url, { method, headers }));
      expect(response.status, `${method} ${url}`).toBe(200);
    }

    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it("stays open in development when auth is not configured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_SECRET", "");

    const response = await proxy(new NextRequest("https://kinsleuth.example/app"));

    expect(response.status).toBe(200);
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });
});

function stubPrivateHostedEnvironment(): void {
  vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "hosted");
  vi.stubEnv("KINRESOLVE_DATASET_MODE", "pilot");
  vi.stubEnv("KINRESOLVE_DNA_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_EXTERNAL_AI_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_PUBLIC_ARCHIVE_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_PUBLIC_PUBLISHING_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_PACKAGE_MEDIA_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_PLAIN_GEDCOM_ENABLED", "true");
}
