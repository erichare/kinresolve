import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getArchiveId: vi.fn(),
  getRuntimeStatus: vi.fn(),
  isRuntimeReady: vi.fn(),
  publicDemoEnabled: vi.fn(),
  readPublicDemoDiagnostics: vi.fn(),
  readJobLagHealth: vi.fn(),
  readWorkerFreshness: vi.fn()
}));

vi.mock("@/lib/observability-probe", () => ({
  authenticateObservabilityProbe: mocks.authenticate
}));
vi.mock("@/lib/runtime-status", () => ({
  getRuntimeStatus: mocks.getRuntimeStatus,
  isRuntimeReady: mocks.isRuntimeReady
}));
vi.mock("@/lib/beta-operations", () => ({
  readJobLagHealth: mocks.readJobLagHealth,
  readWorkerFreshness: mocks.readWorkerFreshness
}));
vi.mock("@/lib/public-demo-config", () => ({
  publicDemoEnabled: mocks.publicDemoEnabled
}));
vi.mock("@/lib/public-demo-session-store", () => ({
  readPublicDemoDiagnostics: mocks.readPublicDemoDiagnostics
}));
vi.mock("@/lib/workspace-store", () => ({
  getArchiveId: mocks.getArchiveId
}));

import { GET } from "@/app/api/internal/health/route";

const probeRequest = new Request("https://app.kinresolve.com/api/internal/health", {
  headers: { authorization: `Bearer ${"p".repeat(48)}` }
});
const originalEnvironment = { ...process.env };

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.KINRESOLVE_BUILD_COMMIT_SHA;
  process.env.VERCEL_GIT_COMMIT_SHA = "c".repeat(40);
  mocks.getArchiveId.mockReturnValue("pilot-archive");
  mocks.getRuntimeStatus.mockResolvedValue(runtimeStatus());
  mocks.isRuntimeReady.mockReturnValue(true);
  mocks.publicDemoEnabled.mockReturnValue(true);
  mocks.readPublicDemoDiagnostics.mockResolvedValue({
    capacity: {
      active: 3,
      maximum: 25,
      provisioning: 1,
      available: 21
    },
    cleanup: {
      leaseHeld: false,
      lastStartedAt: new Date().toISOString(),
      lastCompletedAt: new Date().toISOString(),
      lastFailedAt: null,
      staleProvisioning: 0
    },
    ai: {
      maximumConcurrent: 5,
      maximumDaily: 150,
      usedToday: 12,
      running: 1
    }
  });
  mocks.readWorkerFreshness.mockResolvedValue([
    {
      workerKind: "integration-jobs",
      outcome: "succeeded",
      freshness: "healthy",
      ageSeconds: 15
    }
  ]);
  mocks.readJobLagHealth.mockResolvedValue({
    eligibleCount: 0,
    eligibleCountCapped: false,
    oldestEligibleAgeSeconds: null,
    recentFailedCount: 0,
    recentFailedCountCapped: false,
    freshness: "healthy"
  });
});

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("GET /api/internal/health", () => {
  it("authenticates before reading runtime or worker state", async () => {
    mocks.authenticate.mockReturnValue(false);

    const response = await GET(probeRequest);

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.getRuntimeStatus).not.toHaveBeenCalled();
    expect(mocks.getArchiveId).not.toHaveBeenCalled();
    expect(mocks.readPublicDemoDiagnostics).not.toHaveBeenCalled();
    expect(mocks.readWorkerFreshness).not.toHaveBeenCalled();
    expect(mocks.readJobLagHealth).not.toHaveBeenCalled();
  });

  it("returns allowlisted diagnostics to an authenticated probe", async () => {
    mocks.authenticate.mockReturnValue(true);

    const response = await GET(probeRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      status: "ok",
      product: "KinSleuth",
      version: "0.18.0",
      releaseCommitSha: "c".repeat(40),
      database: {
        configured: true,
        connected: true,
        identityConfigured: true,
        identityMatchesConfigured: true,
        provisioned: true,
        datasetMode: "pilot",
        expectedDatasetMode: "pilot",
        datasetModeMatches: true
      },
      storage: {
        configured: true,
        identityConfigured: true,
        identityVerified: true
      },
      api: { enabled: true, configured: true },
      workers: [
        {
          workerKind: "integration-jobs",
          outcome: "succeeded",
          freshness: "healthy",
          ageSeconds: 15
        }
      ],
      jobLag: {
        eligibleCount: 0,
        eligibleCountCapped: false,
        oldestEligibleAgeSeconds: null,
        recentFailedCount: 0,
        recentFailedCountCapped: false,
        freshness: "healthy"
      },
      publicDemo: {
        capacity: {
          active: 3,
          maximum: 25,
          occupied: 4,
          provisioning: 1
        },
        cleanup: {
          freshness: "healthy",
          lastCompletedAt: expect.any(String)
        },
        staleProvisioning: 0,
        aiBudget: {
          concurrentLimit: 5,
          dailyLimit: 150,
          dailyUsed: 12,
          running: 1
        }
      }
    });
    expect(mocks.readWorkerFreshness).toHaveBeenCalledExactlyOnceWith({
      archiveId: "pilot-archive"
    });
    expect(mocks.readJobLagHealth).toHaveBeenCalledExactlyOnceWith({
      archiveId: "pilot-archive"
    });
    expect(mocks.readPublicDemoDiagnostics).toHaveBeenCalledOnce();
    expect(JSON.stringify(body)).not.toMatch(
      /database-private-marker|archiveName|archiveTagline|archiveCount|peopleCount|caseCount|aiRunCount|baseUrl|chatModel|embeddingModel/
    );
  });

  it("does not leak a heartbeat query failure through the protected probe", async () => {
    mocks.authenticate.mockReturnValue(true);
    mocks.isRuntimeReady.mockReturnValue(false);
    process.env.VERCEL_GIT_COMMIT_SHA = "database-private-marker";
    mocks.readWorkerFreshness.mockRejectedValue(
      new Error("database-private-marker postgres://private-user:private-password@db.internal/pilot")
    );

    const response = await GET(probeRequest);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.releaseCommitSha).toBeNull();
    expect(body.workers).toBeNull();
    expect(body.jobLag).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/database-private-marker|private-password|db\.internal/);
  });

  it.each([
    {
      name: "missing cleanup completion",
      diagnostics: { lastCompletedAt: null, staleProvisioning: 0 }
    },
    {
      name: "stale cleanup completion",
      diagnostics: { lastCompletedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(), staleProvisioning: 0 }
    },
    {
      name: "stale provisioning",
      diagnostics: { lastCompletedAt: new Date().toISOString(), staleProvisioning: 1 }
    }
  ])("degrades protected health for $name", async ({ diagnostics }) => {
    mocks.authenticate.mockReturnValue(true);
    mocks.readPublicDemoDiagnostics.mockResolvedValue({
      capacity: { active: 0, maximum: 25, provisioning: 0, available: 25 },
      cleanup: {
        leaseHeld: false,
        lastStartedAt: diagnostics.lastCompletedAt,
        lastCompletedAt: diagnostics.lastCompletedAt,
        lastFailedAt: null,
        staleProvisioning: diagnostics.staleProvisioning
      },
      ai: { maximumConcurrent: 5, maximumDaily: 150, usedToday: 0, running: 0 }
    });

    const response = await GET(probeRequest);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "degraded" });
  });
});

function runtimeStatus() {
  return {
    product: "KinSleuth",
    version: "0.18.0",
    database: {
      configured: true,
      connected: true,
      identityConfigured: true,
      identity: "a".repeat(64),
      identityMatchesConfigured: true,
      transportVerified: true,
      archiveId: "pilot-archive",
      archiveName: "database-private-marker",
      archiveTagline: "private genealogy",
      archiveCount: 1,
      peopleCount: 12,
      caseCount: 3,
      aiRunCount: 2,
      provisioned: true,
      datasetMode: "pilot",
      expectedDatasetMode: "pilot",
      datasetModeMatches: true,
      demoFixtureVersion: null,
      error: "database-private-marker"
    },
    ai: {
      enabled: false,
      configured: false,
      baseUrl: "https://private-provider.invalid/v1",
      chatModel: "private-chat-model",
      embeddingModel: "private-embedding-model",
      mode: "responses"
    },
    api: { enabled: true, configured: true },
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
    scheduledWrites: { valid: true, configured: true, enabled: true },
    storage: { configured: true, identityConfigured: true, identityVerified: true }
  };
}
