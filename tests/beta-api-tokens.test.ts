import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiV1Enabled,
  apiV1ConfigurationStatus,
  authenticateApiToken,
  createApiTokenForOwner,
  deriveApiTokenDigest
} from "@/lib/beta-api-tokens";

const cursorSecret = "api-cursor-test-secret-that-is-distinct-and-long-enough";
const enabledEnvironment = {
  KINRESOLVE_API_V1_ENABLED: "true",
  KINRESOLVE_API_CURSOR_SECRET: cursorSecret
};

afterEach(() => vi.restoreAllMocks());

describe("beta API token configuration and input boundary", () => {
  it("enables only the exact true value and rejects ambiguous nonempty values", () => {
    expect(apiV1Enabled({})).toBe(false);
    expect(apiV1Enabled({ KINRESOLVE_API_V1_ENABLED: "" })).toBe(false);
    expect(apiV1Enabled({ KINRESOLVE_API_V1_ENABLED: " FALSE " })).toBe(false);
    expect(apiV1Enabled({ KINRESOLVE_API_V1_ENABLED: " TrUe " })).toBe(true);
    expect(() => apiV1Enabled({ KINRESOLVE_API_V1_ENABLED: "1" })).toThrow(/exactly true or false/i);
    expect(() => apiV1Enabled({ KINRESOLVE_API_V1_ENABLED: "yes" })).toThrow(/exactly true or false/i);
    expect(apiV1ConfigurationStatus({})).toEqual({ enabled: false, configured: true });
    expect(apiV1ConfigurationStatus({ KINRESOLVE_API_V1_ENABLED: "invalid" }))
      .toEqual({ enabled: false, configured: false });
    expect(apiV1ConfigurationStatus({ KINRESOLVE_API_V1_ENABLED: "true" }))
      .toEqual({ enabled: true, configured: false });
    expect(apiV1ConfigurationStatus(enabledEnvironment))
      .toEqual({ enabled: true, configured: true });
    expect(apiV1ConfigurationStatus({ ...enabledEnvironment, AUTH_SECRET: cursorSecret }))
      .toEqual({ enabled: true, configured: false });
  });

  it("derives only a fixed digest from a correctly shaped 256-bit bearer", () => {
    const token = `kr_beta_${"A".repeat(43)}`;
    const digest = deriveApiTokenDigest(token);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain("kr_beta");
    expect(() => deriveApiTokenDigest("kr_beta_short")).toThrow(/invalid/i);
  });

  it("fails closed before database work when disabled, misconfigured, or malformed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const requestId = randomUUID();
    const request = new Request("https://app.kinresolve.com/api/v1/meta");
    await expect(authenticateApiToken(request, {
      scope: "archive:read",
      routeTemplate: "/api/v1/meta",
      requestId
    }, { environment: {} })).resolves.toEqual({
      ok: false,
      status: 404,
      code: "api_disabled",
      message: "The API developer preview is not enabled.",
      requestId
    });
    await expect(authenticateApiToken(request, {
      scope: "archive:read",
      routeTemplate: "/api/v1/meta",
      requestId
    }, { environment: { KINRESOLVE_API_V1_ENABLED: "true" } })).resolves.toMatchObject({
      ok: false,
      status: 503,
      code: "service_unavailable",
      requestId
    });
    await expect(authenticateApiToken(request, {
      scope: "archive:read",
      routeTemplate: "/api/v1/meta",
      requestId
    }, { environment: enabledEnvironment })).resolves.toMatchObject({
      ok: false,
      status: 401,
      code: "invalid_token",
      requestId
    });
    await expect(authenticateApiToken(new Request("https://app.kinresolve.com/api/v1/meta", {
      headers: { authorization: `bearer KR_BETA_${"A".repeat(43)}` }
    }), {
      scope: "archive:read",
      routeTemplate: "/api/v1/meta",
      requestId
    }, { environment: enabledEnvironment })).resolves.toMatchObject({
      ok: false,
      status: 401,
      code: "invalid_token",
      requestId
    });
  });

  it("rejects cursor-secret reuse and invalid management input before database access", async () => {
    for (const reusedCredentialName of [
      "AUTH_SECRET",
      "BLOB_READ_WRITE_TOKEN",
      "RESEND_API_KEY",
      "KINRESOLVE_BETA_OPERATOR_PRIVATE_KEY_PKCS8",
      "RECOVERY_AGE_IDENTITY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "VERCEL_TOKEN",
      "AI_API_KEY",
      "KINRESOLVE_BETA_APPLICATION_HMAC_SECRET",
      "OPENAI_API_KEY",
      "MINIO_ROOT_PASSWORD",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY"
    ]) {
      await expect(createApiTokenForOwner({
        archiveId: "archive",
        userId: "owner",
        name: "CLI",
        scopes: ["archive:read"],
        expiresAt: new Date(Date.now() + 60 * 60_000),
        requestId: randomUUID()
      }, {
        environment: {
          ...enabledEnvironment,
          [reusedCredentialName]: cursorSecret
        }
      })).rejects.toMatchObject({ code: "OPERATION_FAILED" });
    }

    const structuredSecret = "api-cursor-structured-secret-with-encoded-at@value";
    for (const [name, databaseUrl] of [
      [
        "DATABASE_URL",
        `postgres://runtime:${encodeURIComponent(structuredSecret)}@db.example.test/kinresolve`
      ],
      [
        "MIGRATION_DATABASE_URL",
        `postgres://${encodeURIComponent(structuredSecret)}:migration@db.example.test/kinresolve`
      ],
      [
        "RECOVERY_TARGET_RUNTIME_DATABASE_URL",
        `postgresql://recovery:${encodeURIComponent(structuredSecret)}@db.example.test/kinresolve`
      ],
      [
        "PUBLIC_DEMO_RUNTIME_DATABASE_URL",
        `postgresql://demo:${encodeURIComponent(structuredSecret)}@db.example.test/kinresolve`
      ]
    ] as const) {
      expect(apiV1ConfigurationStatus({
        KINRESOLVE_API_V1_ENABLED: "true",
        KINRESOLVE_API_CURSOR_SECRET: structuredSecret,
        [name]: databaseUrl
      })).toEqual({ enabled: true, configured: false });
    }

    await expect(createApiTokenForOwner({
      archiveId: "archive",
      userId: "owner",
      name: "CLI",
      scopes: ["archive:read", "archive:read"],
      expiresAt: new Date(Date.now() + 60 * 60_000),
      requestId: randomUUID()
    }, { environment: enabledEnvironment })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
