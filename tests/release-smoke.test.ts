import { describe, expect, it } from "vitest";

import {
  releaseSmokeRequests,
  validateReleaseDatabaseIdentity,
  validateStaticHoldingHealth,
  validatePrivateReleaseHeaders,
  validateReleaseHealth,
  validateReleaseHtml
} from "@/lib/release-smoke";

const expectedVersion = "0.18.0";

describe("non-mutating hosted release smoke contract", () => {
  it("accepts only a missing application health route on the static holding deployment", () => {
    expect(() => validateStaticHoldingHealth({ status: 404 })).not.toThrow();
    expect(() => validateStaticHoldingHealth({ status: 200 })).toThrow(/static holding.*404/i);
    expect(() => validateStaticHoldingHealth({ status: 503 })).toThrow(/static holding.*404/i);
  });

  it("attests database identity even while the old schema keeps health degraded", () => {
    expect(validateReleaseDatabaseIdentity({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify(healthyResponse({ status: "degraded" })),
      expectedVersion,
      expectedDatabaseIdentity: "a".repeat(64)
    })).toEqual({ databaseIdentity: "a".repeat(64) });
  });

  it("accepts only a ready, provisioned cohort-one health response", () => {
    expect(validateReleaseHealth({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(healthyResponse()),
      expectedVersion,
      expectedDatasetMode: "pilot",
      expectedDatabaseIdentity: "a".repeat(64),
      expectedScheduledWritesEnabled: true
    })).toEqual({
      version: expectedVersion,
      datasetMode: "pilot",
      scheduledWritesEnabled: true
    });
  });

  it.each([
    ["non-200 status", { status: 503 }],
    ["HTML holding page", { contentType: "text/html", body: "<html>200</html>" }],
    ["invalid JSON", { body: "not-json" }],
    ["wrong status body", { body: JSON.stringify(healthyResponse({ status: "degraded" })) }],
    ["wrong product", { body: JSON.stringify(healthyResponse({ product: "Holding page" })) }],
    ["wrong version", { body: JSON.stringify(healthyResponse({ version: "0.17.4" })) }],
    ["database disconnected", {
      body: JSON.stringify(healthyResponse({ database: { ...healthyResponse().database, connected: false } }))
    }],
    ["archive not provisioned", {
      body: JSON.stringify(healthyResponse({ database: { ...healthyResponse().database, provisioned: false } }))
    }],
    ["dataset drift", {
      body: JSON.stringify(healthyResponse({
        database: { ...healthyResponse().database, datasetModeMatches: false }
      }))
    }],
    ["storage missing", {
      body: JSON.stringify(healthyResponse({ storage: { configured: false } }))
    }],
    ["capabilities invalid", {
      body: JSON.stringify(healthyResponse({ capabilities: { ...healthyResponse().capabilities, valid: false } }))
    }],
    ["dangerous capability enabled", {
      body: JSON.stringify(healthyResponse({ capabilities: { ...healthyResponse().capabilities, dna: true } }))
    }],
    ["GEDCOM disabled", {
      body: JSON.stringify(healthyResponse({ capabilities: { ...healthyResponse().capabilities, plainGedcom: false } }))
    }],
    ["scheduled writes invalid", {
      body: JSON.stringify(healthyResponse({
        scheduledWrites: { valid: false, configured: false, enabled: false }
      }))
    }],
    ["scheduled writes mismatched", {
      body: JSON.stringify(healthyResponse({
        scheduledWrites: { valid: true, configured: true, enabled: false }
      }))
    }]
  ])("rejects a %s", (_label, overrides) => {
    expect(() => validateReleaseHealth({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(healthyResponse()),
      expectedVersion,
      expectedDatasetMode: "pilot",
      expectedDatabaseIdentity: "a".repeat(64),
      expectedScheduledWritesEnabled: true,
      ...overrides
    })).toThrow();
  });

  it("requires private production security and indexing headers", () => {
    expect(() => validatePrivateReleaseHeaders(new Headers(privateHeaders()))).not.toThrow();

    for (const name of Object.keys(privateHeaders())) {
      const headers = new Headers(privateHeaders());
      headers.delete(name);
      expect(() => validatePrivateReleaseHeaders(headers), name).toThrow(new RegExp(name, "i"));
    }

    const unsafeCsp = new Headers(privateHeaders());
    unsafeCsp.set("content-security-policy", `${unsafeCsp.get("content-security-policy")} 'unsafe-eval'`);
    expect(() => validatePrivateReleaseHeaders(unsafeCsp)).toThrow(/unsafe-eval/i);
  });

  it("rejects an HTML 200 holding or protection page", () => {
    expect(() => validateReleaseHtml({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "<html><title>Kin Resolve</title><p>Invitation-only hosted beta</p></html>"
    })).not.toThrow();
    expect(() => validateReleaseHtml({
      status: 200,
      contentType: "text/html",
      body: "<html><title>Authentication Required</title></html>"
    })).toThrow(/Kin Resolve/i);
    expect(() => validateReleaseHtml({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok" })
    })).toThrow(/HTML/i);
  });

  it("declares only GET and HEAD probes", () => {
    expect(releaseSmokeRequests).not.toHaveLength(0);
    expect(releaseSmokeRequests.every((request) => request.method === "GET" || request.method === "HEAD")).toBe(true);
    expect(releaseSmokeRequests.map((request) => request.path)).toEqual([
      "/login",
      "/api/health",
      "/app",
      "/api/people",
      "/api/cron/integration-jobs",
      "/api/auth/session"
    ]);
  });
});

function healthyResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: "ok",
    product: "KinSleuth",
    version: expectedVersion,
    database: {
      configured: true,
      connected: true,
      identityConfigured: true,
      identity: "a".repeat(64),
      identityMatchesConfigured: true,
      transportVerified: true,
      provisioned: true,
      datasetMode: "pilot",
      expectedDatasetMode: "pilot",
      datasetModeMatches: true,
      demoFixtureVersion: null
    },
    storage: { configured: true, identityConfigured: true, identityVerified: true },
    scheduledWrites: { valid: true, configured: true, enabled: true },
    capabilities: {
      valid: true,
      deploymentMode: "hosted",
      datasetMode: "pilot",
      dna: false,
      externalAi: false,
      publicArchive: false,
      publicPublishing: false,
      evidenceBinaryUploads: false,
      packageMedia: false,
      plainGedcom: true,
      gedcomFileLimitBytes: 10 * 1024 * 1024,
      gedcomPersonLimit: 40_000
    },
    ...overrides
  };
}

function privateHeaders(): Record<string, string> {
  return {
    "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "x-robots-tag": "noindex, nofollow, noarchive"
  };
}
