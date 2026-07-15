import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  ensureDatabaseSchema: vi.fn(),
  getAuth: vi.fn(),
  handlerPost: vi.fn(),
  toNextJsHandler: vi.fn()
}));

vi.mock("@/lib/durable-auth-rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/durable-auth-rate-limit")>();
  return { ...actual, consumeDurableAuthRateLimit: mocks.consume };
});
vi.mock("@/lib/auth-session", () => ({ countUsers: vi.fn() }));
vi.mock("@/lib/db", () => ({ ensureDatabaseSchema: mocks.ensureDatabaseSchema }));
vi.mock("@/lib/auth", () => ({ getAuth: mocks.getAuth }));
vi.mock("better-auth/next-js", () => ({ toNextJsHandler: mocks.toNextJsHandler }));

import { POST } from "@/app/api/auth/[...all]/route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "hosted");
  vi.stubEnv("KINRESOLVE_DATASET_MODE", "pilot");
  vi.stubEnv("KINRESOLVE_BETA_PRIVACY_HMAC_SECRET", "h".repeat(32));
  vi.stubEnv("VERCEL", "1");
  mocks.consume.mockResolvedValue({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
  mocks.ensureDatabaseSchema.mockResolvedValue(undefined);
  mocks.getAuth.mockReturnValue({ handler: "handler" });
  mocks.handlerPost.mockResolvedValue(new Response(null, { status: 204 }));
  mocks.toNextJsHandler.mockReturnValue({ POST: mocks.handlerPost });
});

describe("hosted auth request-body perimeter", () => {
  it.each([
    {
      label: "form-encoded credentials",
      path: "/api/auth/sign-in/email",
      body: new URLSearchParams({
        email: "pilot@example.com",
        password: "not-the-password"
      }).toString(),
      contentType: "application/x-www-form-urlencoded",
      expectedStatus: 415
    },
    {
      label: "malformed reset JSON",
      path: "/api/auth/request-password-reset",
      body: '{"email":',
      contentType: "application/json",
      expectedStatus: 400
    },
    {
      label: "oversized padded credentials",
      path: "/api/auth/sign-in/email",
      body: JSON.stringify({
        email: "pilot@example.com",
        password: "not-the-password",
        padding: "x".repeat(5 * 1024)
      }),
      contentType: "application/json",
      expectedStatus: 413
    }
  ])("rejects $label before schema or Better Auth", async ({
    path,
    body,
    contentType,
    expectedStatus
  }) => {
    const request = new NextRequest(`https://app.kinresolve.com${path}`, {
      method: "POST",
      headers: {
        "content-length": String(Buffer.byteLength(body, "utf8")),
        "content-type": contentType,
        "x-vercel-forwarded-for": "203.0.113.7"
      },
      body
    });

    const response = await POST(request);

    expect(response.status).toBe(expectedStatus);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.ensureDatabaseSchema).not.toHaveBeenCalled();
    expect(mocks.handlerPost).not.toHaveBeenCalled();
  });
});
