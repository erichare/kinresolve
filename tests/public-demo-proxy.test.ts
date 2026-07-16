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

const demoGuestContext = {
  kind: "demo-guest" as const,
  sessionId: "session-demo-1",
  archiveId: "archive-demo-1",
  generation: 1,
  expiresAt: "2026-07-17T12:00:00.000Z"
};

const memberContext = {
  kind: "member" as const,
  userId: "user-1",
  email: "member@example.test",
  name: "Member",
  role: "owner" as const,
  archiveId: "archive-member-1"
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  releaseFenceMocks.getActiveReleaseFence.mockResolvedValue(null);
});

describe("public demo proxy boundary", () => {
  it("allows an exact same-origin session start without authenticating and marks it private", async () => {
    stubDemoEnvironment();

    const response = await proxy(demoRequest("/api/demo/sessions", "POST", true));

    expect(response.status).toBe(200);
    expectPrivateNoIndex(response);
    expect(dbMocks.ensureDatabaseSchema).not.toHaveBeenCalled();
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });

  it.each([
    "/api/demo/sessions",
    "/api/demo/session/reset",
    "/api/demo/session/end",
    "/api/demo/cases/case-mercer-march-identity/guide",
    "/api/demo/sample-import",
    "/api/demo/ai",
    "/api/demo/feedback"
  ])("rejects %s without exact Origin and Fetch Metadata before database access", async (pathname) => {
    stubDemoEnvironment();

    const response = await proxy(demoRequest(pathname, "POST"));

    expect(response.status).toBe(403);
    expectPrivateNoIndex(response);
    expect(dbMocks.ensureDatabaseSchema).not.toHaveBeenCalled();
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
    expect(releaseFenceMocks.getActiveReleaseFence).not.toHaveBeenCalled();
  });

  it("requires a live demo-guest principal for demo session routes", async () => {
    stubDemoEnvironment();
    authMocks.getSessionContext.mockResolvedValue(null);

    const response = await proxy(demoRequest("/api/demo/session"));

    expect(response.status).toBe(401);
    expectPrivateNoIndex(response);
    expect(dbMocks.ensureDatabaseSchema).toHaveBeenCalledOnce();
    expect(authMocks.getSessionContext).toHaveBeenCalledOnce();
  });

  it("does not let a normal member principal use demo command routes", async () => {
    stubDemoEnvironment();
    authMocks.getSessionContext.mockResolvedValue(memberContext);

    const response = await proxy(demoRequest("/api/demo/ai", "POST", true));

    expect(response.status).toBe(403);
    expectPrivateNoIndex(response);
  });

  it("allows a live demo guest to use its dedicated command endpoints", async () => {
    stubDemoEnvironment();
    authMocks.getSessionContext.mockResolvedValue(demoGuestContext);

    const response = await proxy(demoRequest("/api/demo/ai", "POST", true));

    expect(response.status).toBe(200);
    expectPrivateNoIndex(response);
    expect(dbMocks.ensureDatabaseSchema).toHaveBeenCalledOnce();
  });

  it.each([
    ["POST", "/api/cases"],
    ["POST", "/api/imports"],
    ["PATCH", "/api/settings/archive"],
    ["POST", "/api/exports/research-archive"]
  ])("denies demo guests the generic %s %s mutation surface", async (method, pathname) => {
    stubDemoEnvironment();
    authMocks.getSessionContext.mockResolvedValue(demoGuestContext);

    const response = await proxy(demoRequest(pathname, method, true));

    expect(response.status).toBe(403);
    expectPrivateNoIndex(response);
  });

  it("allows the explicit read matrix while keeping guest responses private", async () => {
    stubDemoEnvironment();
    authMocks.getSessionContext.mockResolvedValue(demoGuestContext);

    for (const pathname of ["/api/people", "/api/cases", "/api/dna/matches", "/api/exports/gedcom"]) {
      const response = await proxy(demoRequest(pathname));
      expect(response.status, pathname).toBe(200);
      expectPrivateNoIndex(response);
    }
  });

  it("marks the guest workspace private and non-indexable", async () => {
    stubDemoEnvironment();
    authMocks.getSessionContext.mockResolvedValue(demoGuestContext);

    const response = await proxy(demoRequest("/app/cases"));

    expect(response.status).toBe(200);
    expectPrivateNoIndex(response);
  });

  it.each([
    ["POST", "/api/demo/session"],
    ["GET", "/api/demo/future-command"]
  ])("fails closed for unknown demo method/route %s %s without resolving a session", async (method, pathname) => {
    stubDemoEnvironment();
    authMocks.getSessionContext.mockResolvedValue(demoGuestContext);

    const response = await proxy(demoRequest(pathname, method, method === "POST"));

    expect(response.status).toBe(method === "POST" ? 405 : 404);
    expectPrivateNoIndex(response);
    expect(dbMocks.ensureDatabaseSchema).not.toHaveBeenCalled();
    expect(authMocks.getSessionContext).not.toHaveBeenCalled();
  });
});

function stubDemoEnvironment(): void {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AUTH_SECRET", "a-long-production-secret");
  vi.stubEnv("APP_BASE_URL", "https://demo.kinresolve.com");
  vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "hosted");
  vi.stubEnv("KINRESOLVE_DATASET_MODE", "demo");
  vi.stubEnv("KINRESOLVE_PUBLIC_DEMO_ENABLED", "true");
}

function demoRequest(pathname: string, method = "GET", sameOrigin = false): NextRequest {
  return new NextRequest(`https://demo.kinresolve.com${pathname}`, {
    method,
    headers: sameOrigin
      ? {
          origin: "https://demo.kinresolve.com",
          "sec-fetch-site": "same-origin"
        }
      : undefined
  });
}

function expectPrivateNoIndex(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
}
