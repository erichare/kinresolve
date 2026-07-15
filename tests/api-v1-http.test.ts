import { describe, expect, it } from "vitest";

import {
  apiV1CollectionResponse,
  apiV1ErrorResponse,
  apiV1JsonResponse,
  isApiV1Path
} from "@/lib/api-v1-http";

const requestId = "54c929e1-c30d-4d54-bce0-44bb57007fed";

describe("API v1 HTTP contract", () => {
  it("returns the stable flat error envelope and bearer challenge", async () => {
    const response = apiV1ErrorResponse(401, "invalid_token", "Invalid API token", requestId);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_token",
      message: "Invalid API token",
      requestId
    });
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(response.headers.get("x-request-id")).toBe(requestId);
  });

  it("sets standard rate-limit and security headers on success", () => {
    const response = apiV1JsonResponse({ data: [] }, requestId, {
      rateLimit: { limit: 60, remaining: 59, reset: 42 }
    });

    expect(response.headers.get("ratelimit-limit")).toBe("60");
    expect(response.headers.get("ratelimit-remaining")).toBe("59");
    expect(response.headers.get("ratelimit-reset")).toBe("42");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("returns the required-scope bearer challenge on 403", () => {
    const response = apiV1ErrorResponse(
      403,
      "insufficient_scope",
      "The token does not grant the required scope.",
      requestId,
      { requiredScope: "sources:read" }
    );

    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer realm="Kin Resolve API", error="insufficient_scope", scope="sources:read"'
    );
  });

  it("publishes a relative next-page Link without reflecting the request host", () => {
    const response = apiV1CollectionResponse(
      { page: { nextCursor: "opaque.cursor" } },
      requestId,
      "/api/v1/people",
      25
    );

    expect(response.headers.get("link")).toBe(
      '</api/v1/people?limit=25&cursor=opaque.cursor>; rel="next"'
    );
  });

  it("recognizes only the versioned API namespace", () => {
    expect(isApiV1Path("/api/v1/meta")).toBe(true);
    expect(isApiV1Path("/api/v1")).toBe(true);
    expect(isApiV1Path("/api/v10/meta")).toBe(false);
    expect(isApiV1Path("/api/people")).toBe(false);
  });
});
