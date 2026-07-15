import { describe, expect, it } from "vitest";

import { createApiEdgeEvidence } from "@/lib/api-edge-evidence";
import {
  apiLaunchReleaseAssetName,
  apiLaunchReleaseNotesMarker,
  apiLaunchReleaseNotesMarkerState,
  apiLaunchReleaseReceiptSha256,
  createApiLaunchReleaseReceipt,
  validateApiLaunchReleaseReceipt
} from "@/lib/api-launch-release-receipt";
import type { ProductionApiCanaryEvidence } from "@/lib/production-api-canary";

const capturedAt = new Date("2026-07-15T12:00:10.000Z");
const releaseCommit = "a".repeat(40);
const expectation = {
  repository: "kinresolve/kinresolve",
  releaseCommit,
  releaseVersion: "0.18.0",
  releaseWorkflowRunId: "987654321",
  releaseWorkflowRunAttempt: "3",
  edgeWorkflowRunId: "123456789",
  edgeWorkflowRunAttempt: "2",
  edgeEvidenceSha256: "b".repeat(64),
  canaryEvidenceSha256: "c".repeat(64)
};

describe("API launch release receipt", () => {
  it("combines only strict sanitized edge and canary evidence", () => {
    const receipt = createApiLaunchReleaseReceipt({
      edgeEvidence: edgeEvidence(),
      canaryEvidence: canaryEvidence(),
      expectation,
      now: capturedAt
    });
    expect(receipt).toMatchObject({
      schemaVersion: 1,
      release: {
        repository: expectation.repository,
        commitSha: releaseCommit,
        version: "0.18.0",
        mode: "api-launch",
        workflow: { runId: "987654321", runAttempt: "3" }
      },
      edge: {
        source: {
          runId: "123456789",
          runAttempt: "2",
          evidenceSha256: expectation.edgeEvidenceSha256
        },
        artifactValidated: true,
        liveConfigurationVerifiedBeforePromotion: true,
        liveConfigurationVerifiedAfterPromotion: true,
        bypassesAbsent: true,
        boundedProbePassed: true,
        directOriginDenied: true,
        responseLeakageObserved: false,
        providerLogsReviewed: true
      },
      canary: { evidenceSha256: expectation.canaryEvidenceSha256 }
    });
    const serialized = JSON.stringify(receipt);
    for (const forbidden of [
      "icfg_private", "rule_private", "prj_private_provider", "Private Family",
      "tokenId", "tokenPrefix", "ownerBindingSha256", "archiveBindingSha256"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(apiLaunchReleaseReceiptSha256(receipt)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects release, source, and completion tampering", () => {
    const receipt = createApiLaunchReleaseReceipt({
      edgeEvidence: edgeEvidence(),
      canaryEvidence: canaryEvidence(),
      expectation,
      now: capturedAt
    });
    expect(() => validateApiLaunchReleaseReceipt({
      ...receipt,
      release: { ...receipt.release, commitSha: "d".repeat(40) }
    }, expectation)).toThrow(/release binding/i);
    expect(() => validateApiLaunchReleaseReceipt({
      ...receipt,
      edge: { ...receipt.edge, liveConfigurationVerifiedAfterPromotion: false }
    }, expectation)).toThrow(/edge proof/i);
    expect(() => validateApiLaunchReleaseReceipt({
      ...receipt,
      canary: {
        ...receipt.canary,
        evidence: {
          ...receipt.canary.evidence,
          revocation: { ...receipt.canary.evidence.revocation!, cleanupConfirmed: false }
        }
      }
    }, expectation)).toThrow(/cleanup evidence/i);
  });

  it("renders one exact attempt-qualified notes marker with both workflow identities and hashes", () => {
    const receipt = createApiLaunchReleaseReceipt({
      edgeEvidence: edgeEvidence(),
      canaryEvidence: canaryEvidence(),
      expectation,
      now: capturedAt
    });
    const digest = apiLaunchReleaseReceiptSha256(receipt);
    const marker = apiLaunchReleaseNotesMarker(receipt, digest);
    expect(apiLaunchReleaseAssetName(receipt)).toBe(
      "kinresolve-api-launch-receipt-run-987654321-attempt-3.json"
    );
    expect(marker.match(/kinresolve-api-launch-receipt:v1/g)).toHaveLength(2);
    expect(marker).toContain("kinresolve-api-launch-receipt:v1 run=987654321 attempt=3");
    expect(marker).toContain("run `987654321`, attempt `3`");
    expect(marker).toContain("run `123456789`, attempt `2`");
    expect(marker).toContain(expectation.edgeEvidenceSha256);
    expect(marker).toContain(expectation.canaryEvidenceSha256);
    expect(marker).toContain(digest);
  });

  it("allows immutable receipts from successive rerun attempts without weakening either marker", () => {
    const first = createApiLaunchReleaseReceipt({
      edgeEvidence: edgeEvidence(),
      canaryEvidence: canaryEvidence(),
      expectation,
      now: capturedAt
    });
    const nextExpectation = {
      ...expectation,
      releaseWorkflowRunAttempt: "4",
      canaryEvidenceSha256: "d".repeat(64)
    };
    const next = createApiLaunchReleaseReceipt({
      edgeEvidence: edgeEvidence(),
      canaryEvidence: canaryEvidence(nextExpectation),
      expectation: nextExpectation,
      now: capturedAt
    });
    const firstMarker = apiLaunchReleaseNotesMarker(first, apiLaunchReleaseReceiptSha256(first));
    const nextMarker = apiLaunchReleaseNotesMarker(next, apiLaunchReleaseReceiptSha256(next));
    const firstNotes = `Generated notes\n\n${firstMarker}\n`;
    const bothNotes = `${firstNotes}\n${nextMarker}\n`;

    expect(apiLaunchReleaseAssetName(first)).not.toBe(apiLaunchReleaseAssetName(next));
    expect(apiLaunchReleaseNotesMarkerState(firstNotes, firstMarker)).toBe("present");
    expect(apiLaunchReleaseNotesMarkerState(firstNotes, nextMarker)).toBe("absent");
    expect(apiLaunchReleaseNotesMarkerState(bothNotes, firstMarker)).toBe("present");
    expect(apiLaunchReleaseNotesMarkerState(bothNotes, nextMarker)).toBe("present");
    expect(() => apiLaunchReleaseNotesMarkerState(
      `${bothNotes}\n${nextMarker}`,
      nextMarker
    )).toThrow(/invalid receipt marker sequence/i);
    expect(() => apiLaunchReleaseNotesMarkerState(
      bothNotes.replace(nextExpectation.canaryEvidenceSha256, "e".repeat(64)),
      nextMarker
    )).toThrow(/does not match the current attempt/i);
    expect(() => apiLaunchReleaseNotesMarkerState(
      `${bothNotes}\n<!-- kinresolve-api-launch-receipt:v1 -->`,
      nextMarker
    )).toThrow(/malformed receipt marker/i);
  });
});

function canaryEvidence(
  receiptExpectation = expectation
): ProductionApiCanaryEvidence {
  const probe = (deploymentProtectionBypassUsed: boolean) => ({
    passed: true as const,
    status: 200 as const,
    requestIdPresent: true as const,
    exactSchema: true as const,
    expectedProductVersion: true as const,
    archiveResourceIdIsOpaque: true as const,
    leastPrivilegeCapabilities: true as const,
    privateNoStore: true as const,
    rateLimitHeadersPresent: true as const,
    deploymentProtectionBypassUsed
  });
  return {
    schemaVersion: 1,
    context: {
      releaseCommitSha: releaseCommit,
      repository: receiptExpectation.repository,
      workflowRunId: receiptExpectation.releaseWorkflowRunId,
      workflowRunAttempt: Number(receiptExpectation.releaseWorkflowRunAttempt)
    },
    databaseIdentityAttested: true,
    archiveBindingAttested: true,
    ownerBindingAttested: true,
    leastPrivilegeScopeAttested: true,
    boundedExpiryAttested: true,
    secretFileModeAttested: true,
    candidate: probe(true),
    canonical: probe(false),
    revocation: {
      revoked: true,
      immediateCanonical401: true,
      invalidTokenContract: true,
      requestIdPresent: true,
      cleanupConfirmed: true
    }
  };
}

function edgeEvidence() {
  return createApiEdgeEvidence({
    activeConfig: {
      id: "icfg_private",
      version: 4,
      updatedAt: "2026-07-15T11:59:00.000Z",
      firewallEnabled: true,
      logHeaders: ["x-request-id"],
      ips: [],
      rules: [{
        id: "rule_private",
        active: true,
        valid: true,
        conditionGroup: [{ conditions: [
          { type: "host", op: "eq", value: "app.kinresolve.com" },
          { type: "path", op: "pre", value: "/api/v1/" }
        ] }],
        action: { mitigate: {
          action: "rate_limit",
          bypassSystem: false,
          logHeaders: ["x-request-id"],
          rateLimit: {
            algo: "fixed_window",
            window: 60,
            limit: 5,
            keys: ["ip"],
            action: "rate_limit"
          }
        } }
      }]
    },
    systemBypasses: { result: [] },
    probe: {
      canonicalOrigin: "https://app.kinresolve.com",
      startedAt: "2026-07-15T12:00:01.000Z",
      completedAt: "2026-07-15T12:00:09.000Z",
      ordinaryStatus: 404,
      rateLimitedStatus: 429,
      requestsSent: 7,
      rateLimitedResponses: 2,
      directOriginStatus: 401,
      directOriginProtectionVerified: true,
      responseLeakageObserved: false,
      providerLogsReviewed: true
    },
    expectedRule: { ruleId: "rule_private", limit: 5, windowSeconds: 60 },
    repository: expectation.repository,
    releaseCommit,
    runId: expectation.edgeWorkflowRunId,
    runAttempt: expectation.edgeWorkflowRunAttempt,
    providerProjectId: "prj_private_provider",
    directOrigin: "https://private-candidate.vercel.app",
    capturedAt
  });
}
