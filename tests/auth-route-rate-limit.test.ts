import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { evaluateHostedAuthRateLimit } from "@/lib/auth-route-rate-limit";
import type { ConsumeDurableAuthRateLimitInput } from "@/lib/durable-auth-rate-limit";

const environment = {
  KINRESOLVE_BETA_PRIVACY_HMAC_SECRET: "h".repeat(32),
  VERCEL: "1"
};

function allowingConsume() {
  return vi.fn(async () => ({
    allowed: true,
    remaining: 1,
    retryAfterSeconds: 0
  }));
}

function request(path: string, body: unknown): NextRequest {
  return rawRequest(path, JSON.stringify(body), "application/json");
}

function rawRequest(path: string, body: string, contentType: string): NextRequest {
  return new NextRequest(`https://app.kinresolve.com${path}`, {
    body,
    headers: {
      "content-type": contentType,
      "x-forwarded-for": "203.0.113.99",
      "x-vercel-forwarded-for": "203.0.113.7"
    },
    method: "POST"
  });
}

describe("hosted Better Auth durable rate limits", () => {
  it.each([
    ["/api/auth/sign-in/email", { email: " Pilot@Example.COM " }, ["auth:sign-in:ip", "auth:sign-in:email"]],
    ["/api/auth/request-password-reset", { email: "pilot@example.com" }, ["auth:password-reset-request:ip", "auth:password-reset-request:email"]],
    ["/api/auth/reset-password", { token: "resetToken1234567890", newPassword: "new-password" }, ["auth:password-reset-consume:ip", "auth:password-reset-consume:token"]]
  ] as const)("consumes IP and private-subject buckets for %s", async (path, body, expectedScopes) => {
    const calls: ConsumeDurableAuthRateLimitInput[] = [];
    const consume = vi.fn(async (input: ConsumeDurableAuthRateLimitInput) => {
      calls.push(input);
      return { allowed: true, remaining: 1, retryAfterSeconds: 0 };
    });

    await expect(evaluateHostedAuthRateLimit(request(path, body), { consume, environment }))
      .resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });

    expect(calls.map((call) => call.scope)).toEqual(expectedScopes);
    expect(calls.every((call) => call.hmacSecret === environment.KINRESOLVE_BETA_PRIVACY_HMAC_SECRET)).toBe(true);
    expect(calls[0].subject).toBe("client-address:203.0.113.7");
  });

  it("returns the longest denial without exposing the limited subject", async () => {
    const consume = vi.fn(async (input: ConsumeDurableAuthRateLimitInput) => ({
      allowed: input.scope.endsWith(":ip"),
      remaining: 0,
      retryAfterSeconds: input.scope.endsWith(":ip") ? 0 : 417
    }));

    await expect(evaluateHostedAuthRateLimit(request(
      "/api/auth/request-password-reset",
      { email: "private@example.com" }
    ), { consume, environment })).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 417
    });
  });

  it("does not create a high-cardinality email bucket after the client bucket is denied", async () => {
    const consume = vi.fn(async (_input: ConsumeDurableAuthRateLimitInput) => ({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 417
    }));

    await expect(evaluateHostedAuthRateLimit(request(
      "/api/auth/request-password-reset",
      { email: "attacker-controlled-unique@example.com" }
    ), { consume, environment })).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 417
    });
    expect(consume).toHaveBeenCalledOnce();
    expect(consume.mock.calls[0][0].scope).toBe("auth:password-reset-request:ip");
    expect(consume.mock.calls[0][0].subject).toBe("client-address:203.0.113.7");
  });

  it("does not inspect unrelated Better Auth requests", async () => {
    const consume = vi.fn();
    await expect(evaluateHostedAuthRateLimit(request("/api/auth/sign-out", {}), { consume, environment }))
      .resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(consume).not.toHaveBeenCalled();
  });

  it("rejects Better Auth's form-encoded sign-in alias instead of silently dropping the email bucket", async () => {
    const consume = allowingConsume();
    const encoded = new URLSearchParams({
      email: "pilot@example.com",
      password: "not-the-password"
    }).toString();

    await expect(evaluateHostedAuthRateLimit(rawRequest(
      "/api/auth/sign-in/email",
      encoded,
      "application/x-www-form-urlencoded"
    ), { consume, environment })).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA_TYPE"
    });
    expect(consume).not.toHaveBeenCalled();
  });

  it.each([
    ["/api/auth/sign-in/email", { email: "pilot@example.com", password: "not-the-password" }],
    ["/api/auth/request-password-reset", { email: "pilot@example.com" }],
    ["/api/auth/reset-password", { token: "resetToken1234567890", newPassword: "new-password" }]
  ] as const)("rejects padded JSON before Better Auth for %s", async (path, body) => {
    const consume = allowingConsume();

    await expect(evaluateHostedAuthRateLimit(request(path, {
      ...body,
      padding: "x".repeat(5 * 1024)
    }), { consume, environment })).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE"
    });
    expect(consume).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before consuming any rate-limit bucket", async () => {
    const consume = allowingConsume();

    await expect(evaluateHostedAuthRateLimit(rawRequest(
      "/api/auth/request-password-reset",
      '{"email":',
      "application/json"
    ), { consume, environment })).rejects.toMatchObject({
      code: "MALFORMED_BODY"
    });
    expect(consume).not.toHaveBeenCalled();
  });

  it.each([
    ["/api/auth/sign-in/email", { password: "not-the-password" }],
    ["/api/auth/request-password-reset", {}],
    ["/api/auth/reset-password", { newPassword: "new-password" }]
  ] as const)("rejects a missing private rate-limit subject for %s", async (path, body) => {
    const consume = allowingConsume();

    await expect(evaluateHostedAuthRateLimit(request(path, body), { consume, environment }))
      .rejects.toMatchObject({ code: "MALFORMED_BODY" });
    expect(consume).not.toHaveBeenCalled();
  });
});
