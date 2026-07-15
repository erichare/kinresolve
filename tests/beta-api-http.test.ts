import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import {
  betaErrorResponse,
  betaJsonResponse,
  evaluateBetaRateLimits,
  readBetaJsonBody
} from "@/lib/beta-api-http";
import type { ConsumeDurableAuthRateLimitInput } from "@/lib/durable-auth-rate-limit";

function request(body: string, headers: HeadersInit = {}): NextRequest {
  return new NextRequest("https://app.kinresolve.com/api/beta/invitations/accept", {
    body,
    headers: {
      "content-type": "application/json",
      "x-vercel-forwarded-for": "203.0.113.7",
      ...headers
    },
    method: "POST"
  });
}

describe("beta API HTTP boundary", () => {
  it("reads one bounded UTF-8 JSON body", async () => {
    await expect(readBetaJsonBody(request('{"token":"safe"}'))).resolves.toEqual({ token: "safe" });
    await expect(readBetaJsonBody(request("{}", { "content-type": "text/plain" }))).rejects.toThrow();
    await expect(readBetaJsonBody(request("{}", { "content-length": String(16 * 1024 + 1) }))).rejects.toThrow();
  });

  it("consumes private-subject and edge-IP buckets without returning either", async () => {
    const calls: ConsumeDurableAuthRateLimitInput[] = [];
    const consume = vi.fn(async (input: ConsumeDurableAuthRateLimitInput) => {
      calls.push(input);
      return { allowed: true, remaining: 1, retryAfterSeconds: 0 };
    });
    await expect(evaluateBetaRateLimits(request("{}"), [{
      maximumRequests: 5,
      scope: "beta:invite-token",
      subject: "token:private-bearer",
      windowSeconds: 900
    }], {
      consume,
      environment: {
        KINRESOLVE_BETA_PRIVACY_HMAC_SECRET: "h".repeat(32),
        VERCEL: "1"
      }
    })).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(calls.map((call) => call.scope)).toEqual([
      "beta-route:invitations:accept:ip",
      "beta:invite-token"
    ]);
    expect(calls[0].subject).toBe("client-address:203.0.113.7");
  });

  it("does not create a high-cardinality subject bucket after the client bucket is denied", async () => {
    const consume = vi.fn(async (_input: ConsumeDurableAuthRateLimitInput) => ({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 417
    }));

    await expect(evaluateBetaRateLimits(request("{}"), [{
      maximumRequests: 5,
      scope: "beta:invite-token",
      subject: "token:attacker-controlled-unique-value",
      windowSeconds: 900
    }], {
      consume,
      environment: {
        KINRESOLVE_BETA_PRIVACY_HMAC_SECRET: "h".repeat(32),
        VERCEL: "1"
      }
    })).resolves.toEqual({ allowed: false, retryAfterSeconds: 417 });
    expect(consume).toHaveBeenCalledOnce();
    expect(consume.mock.calls[0][0].scope).toBe("beta-route:invitations:accept:ip");
    expect(consume.mock.calls[0][0].subject).toBe("client-address:203.0.113.7");
  });

  it("returns request IDs, no-store, and bounded retry metadata", () => {
    const success = betaJsonResponse({ ok: true }, { requestId: "request-1" });
    const error = betaErrorResponse(429, "Too many requests", {
      requestId: "request-2",
      retryAfterSeconds: 0
    });
    expect(success.headers.get("cache-control")).toBe("private, no-store");
    expect(success.headers.get("x-request-id")).toBe("request-1");
    expect(error.headers.get("cache-control")).toBe("private, no-store");
    expect(error.headers.get("x-request-id")).toBe("request-2");
    expect(error.headers.get("retry-after")).toBe("1");
  });
});
