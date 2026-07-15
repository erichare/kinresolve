import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureDatabaseSchema: vi.fn(),
  evaluate: vi.fn(),
  getAuth: vi.fn(),
  handlerPost: vi.fn(),
  toNextJsHandler: vi.fn()
}));

vi.mock("@/lib/auth-route-rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-route-rate-limit")>();
  return { ...actual, evaluateHostedAuthRateLimit: mocks.evaluate };
});
vi.mock("@/lib/auth-session", () => ({ countUsers: vi.fn() }));
vi.mock("@/lib/db", () => ({ ensureDatabaseSchema: mocks.ensureDatabaseSchema }));
vi.mock("@/lib/auth", () => ({ getAuth: mocks.getAuth }));
vi.mock("better-auth/next-js", () => ({ toNextJsHandler: mocks.toNextJsHandler }));

import { POST } from "@/app/api/auth/[...all]/route";

function request(): NextRequest {
  return new NextRequest("https://app.kinresolve.com/api/auth/request-password-reset", {
    body: JSON.stringify({ email: "pilot@example.com" }),
    headers: { "content-type": "application/json" },
    method: "POST"
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "hosted");
  vi.stubEnv("KINRESOLVE_DATASET_MODE", "pilot");
  mocks.ensureDatabaseSchema.mockResolvedValue(undefined);
  mocks.getAuth.mockReturnValue({ handler: "handler" });
  mocks.handlerPost.mockResolvedValue(Response.json({ status: true }));
  mocks.toNextJsHandler.mockReturnValue({ POST: mocks.handlerPost });
});

describe("hosted auth route rate-limit perimeter", () => {
  it("returns one generic no-store denial before Better Auth", async () => {
    mocks.evaluate.mockResolvedValue({ allowed: false, retryAfterSeconds: 417 });

    const response = await POST(request());

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: "Too many requests. Try again later." });
    expect(response.headers.get("retry-after")).toBe("417");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.ensureDatabaseSchema).not.toHaveBeenCalled();
    expect(mocks.handlerPost).not.toHaveBeenCalled();
  });

  it("fails closed without reflecting limiter errors", async () => {
    mocks.evaluate.mockRejectedValue(new Error("private@example.com raw-ip token-secret"));

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/private@example|raw-ip|token-secret/);
    expect(mocks.handlerPost).not.toHaveBeenCalled();
  });

  it("forwards an allowed request and decorates the response", async () => {
    mocks.evaluate.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.ensureDatabaseSchema).toHaveBeenCalledOnce();
    expect(mocks.handlerPost).toHaveBeenCalledOnce();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
