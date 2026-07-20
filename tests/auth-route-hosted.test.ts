import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  countUsers: vi.fn(),
  evaluateHostedAuthRateLimit: vi.fn(),
  ensureDatabaseSchema: vi.fn(),
  getAuth: vi.fn(),
  handlerGet: vi.fn(),
  handlerPost: vi.fn(),
  toNextJsHandler: vi.fn()
}));

vi.mock("@/lib/auth-session", () => ({ countUsers: routeMocks.countUsers }));
vi.mock("@/lib/auth-route-rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-route-rate-limit")>();
  return {
    ...actual,
    evaluateHostedAuthRateLimit: routeMocks.evaluateHostedAuthRateLimit
  };
});
vi.mock("@/lib/db", () => ({ ensureDatabaseSchema: routeMocks.ensureDatabaseSchema }));
vi.mock("@/lib/auth", () => ({ getAuth: routeMocks.getAuth }));
vi.mock("better-auth/next-js", () => ({ toNextJsHandler: routeMocks.toNextJsHandler }));

import { GET, POST } from "@/app/api/auth/[...all]/route";

function signUpRequest(): NextRequest {
  return new NextRequest("https://app.kinresolve.com/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "pilot@example.com", name: "Pilot", password: "long-password-123" })
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "self-hosted");
  vi.stubEnv("KINRESOLVE_DATASET_MODE", "demo");
  vi.stubEnv("KINSLEUTH_ALLOW_SIGNUPS", "");
  routeMocks.countUsers.mockResolvedValue(0);
  routeMocks.evaluateHostedAuthRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  routeMocks.ensureDatabaseSchema.mockResolvedValue(undefined);
  routeMocks.getAuth.mockReturnValue({ handler: "better-auth-handler" });
  routeMocks.handlerGet.mockResolvedValue(new Response(null, { status: 204 }));
  routeMocks.handlerPost.mockResolvedValue(new Response(null, { status: 204 }));
  routeMocks.toNextJsHandler.mockReturnValue({ GET: routeMocks.handlerGet, POST: routeMocks.handlerPost });
});

describe("hosted auth route perimeter", () => {
  it.each([
    "/api/auth/list-sessions",
    "/api/auth/reset-password/private-reset-token?callbackURL=%2Freset-password"
  ])("denies the hosted token-bearing GET surface %s", async (pathname) => {
    vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("KINRESOLVE_DATASET_MODE", "pilot");

    const response = await GET(new NextRequest(`https://app.kinresolve.com${pathname}`));

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(routeMocks.ensureDatabaseSchema).not.toHaveBeenCalled();
    expect(routeMocks.handlerGet).not.toHaveBeenCalled();
  });

  it.each([
    "/api/auth/revoke-session",
    "/api/auth/revoke-sessions",
    "/api/auth/revoke-other-sessions"
  ])("denies the unaudited Better Auth session mutation %s in hosted mode", async (pathname) => {
    vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("KINRESOLVE_DATASET_MODE", "pilot");
    const request = new NextRequest(`https://app.kinresolve.com${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });

    const response = await POST(request);

    expect(response.status).toBe(404);
    expect(routeMocks.ensureDatabaseSchema).not.toHaveBeenCalled();
    expect(routeMocks.getAuth).not.toHaveBeenCalled();
  });

  it("denies hosted sign-up before schema, user-count, or auth access even when the override is true", async () => {
    vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("KINRESOLVE_DATASET_MODE", "pilot");
    vi.stubEnv("KINSLEUTH_ALLOW_SIGNUPS", "true");

    const response = await POST(signUpRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Sign-up is unavailable." });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(routeMocks.ensureDatabaseSchema).not.toHaveBeenCalled();
    expect(routeMocks.countUsers).not.toHaveBeenCalled();
    expect(routeMocks.getAuth).not.toHaveBeenCalled();
    expect(routeMocks.toNextJsHandler).not.toHaveBeenCalled();
  });

  it("preserves first-account setup for a self-hosted deployment", async () => {
    const response = await POST(signUpRequest());

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(routeMocks.ensureDatabaseSchema).toHaveBeenCalledOnce();
    expect(routeMocks.countUsers).toHaveBeenCalledOnce();
    expect(routeMocks.handlerPost).toHaveBeenCalledOnce();
  });

  it("accepts the canonical KINRESOLVE_ALLOW_SIGNUPS name for the self-hosted sign-up gate", async () => {
    routeMocks.countUsers.mockResolvedValue(1);
    vi.stubEnv("KINSLEUTH_ALLOW_SIGNUPS", undefined);
    vi.stubEnv("KINRESOLVE_ALLOW_SIGNUPS", "true");

    const allowed = await POST(signUpRequest());
    expect(allowed.status).toBe(204);
    expect(routeMocks.handlerPost).toHaveBeenCalledOnce();

    vi.stubEnv("KINRESOLVE_ALLOW_SIGNUPS", "false");
    const denied = await POST(signUpRequest());
    expect(denied.status).toBe(403);
  });

  it("fails closed when the canonical and legacy sign-up settings disagree", async () => {
    routeMocks.countUsers.mockResolvedValue(1);
    vi.stubEnv("KINSLEUTH_ALLOW_SIGNUPS", "false");
    vi.stubEnv("KINRESOLVE_ALLOW_SIGNUPS", "true");

    await expect(POST(signUpRequest())).rejects.toThrow(
      /KINRESOLVE_ALLOW_SIGNUPS and KINSLEUTH_ALLOW_SIGNUPS are both set but hold different values/
    );
    expect(routeMocks.handlerPost).not.toHaveBeenCalled();
  });

  it("preserves Better Auth's form-encoded sign-in behavior for self-hosted deployments", async () => {
    const request = new NextRequest("https://self-hosted.example/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email: "owner@example.com",
        password: "self-hosted-password"
      }).toString()
    });

    const response = await POST(request);

    expect(response.status).toBe(204);
    expect(routeMocks.evaluateHostedAuthRateLimit).not.toHaveBeenCalled();
    expect(routeMocks.ensureDatabaseSchema).toHaveBeenCalledOnce();
    expect(routeMocks.handlerPost).toHaveBeenCalledWith(request);
  });
});
