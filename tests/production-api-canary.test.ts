import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  appendProductionApiCanaryProbeEvidence,
  markProductionApiCanaryCleanupConfirmed,
  markProductionApiCanaryImmediate401,
  markProductionApiCanaryRevoked,
  probeProductionApiCanary,
  probeRevokedProductionApiCanary,
  productionApiCanaryEvidenceSha256,
  productionApiCanaryMaximumLifetimeMs,
  productionApiCanaryName,
  validateProductionApiCanaryEvidence,
  validateProductionApiCanaryMetadata,
  type ProductionApiCanaryContext,
  type ProductionApiCanaryEvidence,
  type ProductionApiCanaryMetadata
} from "@/lib/production-api-canary";

const context: ProductionApiCanaryContext = {
  releaseCommitSha: "a".repeat(40),
  repository: "kinresolve/kinresolve",
  workflowRunId: "1234567890",
  workflowRunAttempt: 2
};
const createdAt = new Date("2026-07-15T18:00:00.000Z");
const expiresAt = new Date(createdAt.getTime() + productionApiCanaryMaximumLifetimeMs);
const token = `kr_beta_${"A".repeat(43)}`;
const archiveResourceId = "11111111-2222-4333-8444-555555555555";
const metadata: ProductionApiCanaryMetadata = {
  schemaVersion: 1,
  context,
  databaseIdentity: "b".repeat(64),
  archiveBindingSha256: "c".repeat(64),
  archiveResourceBindingSha256: archiveResourceBinding(archiveResourceId),
  ownerBindingSha256: "e".repeat(64),
  tokenId: "11111111-1111-4111-8111-111111111111",
  tokenPrefix: `kr_beta_${"A".repeat(8)}`,
  tokenName: productionApiCanaryName(context),
  scopes: ["archive:read"],
  createdAt: createdAt.toISOString(),
  expiresAt: expiresAt.toISOString(),
  createRequestId: "22222222-2222-4222-8222-222222222222"
};
const initialEvidence: ProductionApiCanaryEvidence = {
  schemaVersion: 1,
  context,
  databaseIdentityAttested: true,
  archiveBindingAttested: true,
  ownerBindingAttested: true,
  leastPrivilegeScopeAttested: true,
  boundedExpiryAttested: true,
  secretFileModeAttested: true
};

describe("production API canary contract", () => {
  it("binds a predictable least-privilege token name to the release run", () => {
    expect(productionApiCanaryName(context)).toBe(
      "release-api-canary-aaaaaaaaaaaa-1234567890-2"
    );
    expect(validateProductionApiCanaryMetadata(metadata, context)).toEqual(metadata);
    expect(metadata.scopes).toEqual(["archive:read"]);
    expect(expiresAt.getTime() - createdAt.getTime()).toBe(120 * 60_000);
  });

  it("rejects metadata whose expiry exceeds the two-hour cancellation failsafe", () => {
    expect(() => validateProductionApiCanaryMetadata({
      ...metadata,
      expiresAt: new Date(
        createdAt.getTime() + productionApiCanaryMaximumLifetimeMs + 1
      ).toISOString()
    }, context)).toThrow(/maximum lifetime/i);
  });

  it("calls only candidate /api/v1/meta with both bearer and Vercel bypass", async () => {
    const fetchImplementation = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      expect(String(url)).toBe("https://kinresolve-candidate-abc.vercel.app/api/v1/meta");
      expect(init?.method).toBe("GET");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${token}`);
      expect(headers.get("x-vercel-protection-bypass")).toBe("x".repeat(43));
      return successfulMetaResponse();
    });

    const evidence = await probeProductionApiCanary({
      phase: "candidate",
      origin: "https://kinresolve-candidate-abc.vercel.app",
      token,
      metadata,
      context,
      expectedProductVersion: "0.18.0",
      vercelAutomationBypassSecret: "x".repeat(43),
      fetchImplementation: fetchImplementation as typeof fetch,
      now: new Date("2026-07-15T18:05:00.000Z")
    });

    expect(evidence).toMatchObject({
      passed: true,
      status: 200,
      exactSchema: true,
      leastPrivilegeCapabilities: true,
      deploymentProtectionBypassUsed: true
    });
    expect(JSON.stringify(evidence)).not.toMatch(/Private Family|11111111-2222/);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("calls canonical /meta without a bypass and rejects any extra capability", async () => {
    const fetchImplementation = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(new Headers(init?.headers).has("x-vercel-protection-bypass")).toBe(false);
      return successfulMetaResponse({ sources: true });
    });
    await expect(probeProductionApiCanary({
      phase: "canonical",
      origin: "https://app.kinresolve.com",
      token,
      metadata,
      context,
      expectedProductVersion: "0.18.0",
      fetchImplementation: fetchImplementation as typeof fetch,
      now: new Date("2026-07-15T18:05:00.000Z")
    })).rejects.toThrow(/capabilities beyond archive:read/i);

    await expect(probeProductionApiCanary({
      phase: "canonical",
      origin: "https://app.kinresolve.com",
      token,
      metadata,
      context,
      expectedProductVersion: "0.18.0",
      vercelAutomationBypassSecret: "x".repeat(43),
      fetchImplementation: fetchImplementation as typeof fetch,
      now: new Date("2026-07-15T18:05:00.000Z")
    })).rejects.toThrow(/public edge without a bypass/i);
  });

  it("rejects a valid opaque UUID belonging to any archive other than the attested target", async () => {
    const fetchImplementation = vi.fn(async () => successfulMetaResponse(
      {},
      "99999999-9999-4999-8999-999999999999"
    ));
    await expect(probeProductionApiCanary({
      phase: "canonical",
      origin: "https://app.kinresolve.com",
      token,
      metadata,
      context,
      expectedProductVersion: "0.18.0",
      fetchImplementation: fetchImplementation as typeof fetch,
      now: new Date("2026-07-15T18:05:00.000Z")
    })).rejects.toThrow(/archive projection/i);
  });

  it("rejects cache and media-type substring lookalikes", async () => {
    for (const [header, expectedError] of [
      [{ "content-type": "application/json-bogus" }, /not JSON/i],
      [{ "cache-control": "not-private, x-no-store=1" }, /not private and non-cacheable/i],
      [{ "cache-control": "private, no-store, public, max-age=3600" }, /not private and non-cacheable/i],
      [{ "cache-control": "private, private, no-store" }, /duplicate directives/i]
    ] as const) {
      const fetchImplementation = vi.fn(async () => successfulMetaResponse({}, archiveResourceId, header));
      await expect(probeProductionApiCanary({
        phase: "canonical",
        origin: "https://app.kinresolve.com",
        token,
        metadata,
        context,
        expectedProductVersion: "0.18.0",
        fetchImplementation: fetchImplementation as typeof fetch,
        now: new Date("2026-07-15T18:05:00.000Z")
      })).rejects.toThrow(expectedError);
    }
  });

  it("binds candidate and canonical probes to their exact origin classes", async () => {
    const fetchImplementation = vi.fn(async () => successfulMetaResponse());
    await expect(probeProductionApiCanary({
      phase: "candidate",
      origin: "https://app.kinresolve.com",
      token,
      metadata,
      context,
      expectedProductVersion: "0.18.0",
      vercelAutomationBypassSecret: "x".repeat(43),
      fetchImplementation: fetchImplementation as typeof fetch,
      now: new Date("2026-07-15T18:05:00.000Z")
    })).rejects.toThrow(/generated Vercel deployment/i);
    await expect(probeProductionApiCanary({
      phase: "candidate",
      origin: "https://candidate.example.test",
      token,
      metadata,
      context,
      expectedProductVersion: "0.18.0",
      vercelAutomationBypassSecret: "x".repeat(43),
      fetchImplementation: fetchImplementation as typeof fetch,
      now: new Date("2026-07-15T18:05:00.000Z")
    })).rejects.toThrow(/generated Vercel deployment/i);
    await expect(probeProductionApiCanary({
      phase: "canonical",
      origin: "https://kinresolve-candidate-abc.vercel.app",
      token,
      metadata,
      context,
      expectedProductVersion: "0.18.0",
      fetchImplementation: fetchImplementation as typeof fetch,
      now: new Date("2026-07-15T18:05:00.000Z")
    })).rejects.toThrow(/canonical API canary origin/i);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("fails closed after expiry without making a network request", async () => {
    const fetchImplementation = vi.fn();
    await expect(probeProductionApiCanary({
      phase: "canonical",
      origin: "https://app.kinresolve.com",
      token,
      metadata,
      context,
      expectedProductVersion: "0.18.0",
      fetchImplementation: fetchImplementation as typeof fetch,
      now: expiresAt
    })).rejects.toThrow(/expired/i);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("proves the exact immediate invalid-token response after revocation", async () => {
    const fetchImplementation = vi.fn(async () => revokedResponse());
    await expect(probeRevokedProductionApiCanary({
      origin: "https://app.kinresolve.com",
      token,
      metadata,
      context,
      fetchImplementation: fetchImplementation as typeof fetch,
      now: new Date("2026-07-15T18:10:00.000Z")
    })).resolves.toEqual({
      immediateCanonical401: true,
      invalidTokenContract: true,
      requestIdPresent: true
    });
    await expect(probeRevokedProductionApiCanary({
      origin: "https://kinresolve-candidate-abc.vercel.app",
      token,
      metadata,
      context,
      fetchImplementation: fetchImplementation as typeof fetch,
      now: new Date("2026-07-15T18:10:00.000Z")
    })).rejects.toThrow(/canonical API canary origin/i);
    await expect(probeRevokedProductionApiCanary({
      origin: "https://app.kinresolve.com",
      token,
      metadata,
      context,
      fetchImplementation: fetchImplementation as typeof fetch,
      now: expiresAt
    })).rejects.toThrow(/expired/i);
  });

  it("accepts only the candidate-canonical-revoke-401-cleanup evidence order", () => {
    const candidate = successfulProbeEvidence(true);
    const canonical = successfulProbeEvidence(false);
    let evidence = appendProductionApiCanaryProbeEvidence(
      initialEvidence,
      "candidate",
      candidate
    );
    evidence = appendProductionApiCanaryProbeEvidence(evidence, "canonical", canonical);
    evidence = markProductionApiCanaryRevoked(evidence);
    evidence = markProductionApiCanaryImmediate401(evidence);
    evidence = markProductionApiCanaryCleanupConfirmed(evidence);

    expect(validateProductionApiCanaryEvidence(evidence, context, { complete: true }))
      .toEqual(evidence);
    expect(productionApiCanaryEvidenceSha256(evidence)).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(evidence)).not.toMatch(
      /tokenId|tokenPrefix|ownerBindingSha256|archiveBindingSha256|archiveResourceBindingSha256|Private Family/
    );
  });

  it("keeps the CLI secret in a private runner file and errors generically", async () => {
    const script = await readFile(
      path.join(process.cwd(), "scripts", "production-api-canary.mjs"),
      "utf8"
    );
    expect(script).toContain("loadReleaseContractFiles");
    expect(script).toContain('process.env.DATABASE_AUTO_MIGRATE = "false"');
    expect(script).toContain('open(filePath, "wx", 0o600)');
    expect(script).toContain("(info.mode & 0o777) !== 0o600");
    expect(script).toContain("KINRESOLVE_API_CANARY_OWNER_USER_ID");
    expect(script).toContain("MIGRATION_DATABASE_URL");
    expect(script).toContain("removeRunnerFilesAfterRevocation");
    expect(script).toContain("isValidatedCompleteEvidence");
    expect(script).toContain("if (!preserveCompleteEvidence)");
    expect(script).toContain("console.error(`Production API canary ${command} failed.`)");
    expect(script).not.toMatch(/console\.(?:log|error)\([^\n]*(?:prepared\.token|metadata|response|body)/);
  });
});

function successfulMetaResponse(
  capabilityOverride: Record<string, boolean> = {},
  projectedArchiveId = archiveResourceId,
  headerOverride: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify({
    data: {
      apiVersion: "v1",
      productVersion: "0.18.0",
      archive: {
        id: projectedArchiveId,
        name: "Private Family",
        tagline: "A private archive"
      },
      capabilities: {
        people: true,
        sources: false,
        cases: false,
        qualityReport: false,
        gedcomExport: false,
        ...capabilityOverride
      }
    }
  }), {
    status: 200,
    headers: apiHeaders({
      "ratelimit-limit": "60",
      "ratelimit-remaining": "59",
      "ratelimit-reset": "60",
      ...headerOverride
    })
  });
}

function revokedResponse(): Response {
  const requestId = "33333333-3333-4333-8333-333333333333";
  return new Response(JSON.stringify({
    code: "invalid_token",
    message: "The bearer token is invalid, expired, or revoked.",
    requestId
  }), {
    status: 401,
    headers: apiHeaders({
      "www-authenticate": 'Bearer realm="Kin Resolve API", error="invalid_token"'
    })
  });
}

function apiHeaders(extra: Record<string, string>): Headers {
  return new Headers({
    "cache-control": "private, no-store, max-age=0",
    "content-type": "application/json",
    vary: "Authorization",
    "x-content-type-options": "nosniff",
    "x-request-id": "44444444-4444-4444-8444-444444444444",
    ...extra
  });
}

function successfulProbeEvidence(deploymentProtectionBypassUsed: boolean) {
  return {
    passed: true,
    status: 200,
    requestIdPresent: true,
    exactSchema: true,
    expectedProductVersion: true,
    archiveResourceIdIsOpaque: true,
    leastPrivilegeCapabilities: true,
    privateNoStore: true,
    rateLimitHeadersPresent: true,
    deploymentProtectionBypassUsed
  } as const;
}

function archiveResourceBinding(value: string): string {
  return createHash("sha256")
    .update("kinresolve-production-api-canary-archive-resource-v1\0", "utf8")
    .update(value, "utf8")
    .digest("hex");
}
