import { describe, expect, it, vi } from "vitest";

import {
  integrationWorkerConfiguration,
  runIntegrationWorkerBatch
} from "@/lib/integrations/worker";

describe("bounded integration worker protocol", () => {
  it("leases archive-scoped parse jobs and completes them with fencing tokens", async () => {
    const lease = leasedJob("job-1", "run-1", "lease-1");
    const dependencies = {
      listArchiveIds: vi.fn(async () => ["archive-synthetic"]),
      leaseNextJob: vi.fn()
        .mockResolvedValueOnce(lease)
        .mockResolvedValueOnce(null),
      processIntegrationSyncRun: vi.fn(async () => ({ run: { id: "run-1" } })),
      completeJob: vi.fn(async () => ({ ...lease, state: "completed" })),
      failJob: vi.fn()
    };

    const result = await runIntegrationWorkerBatch(
      {
        workerId: "worker-test",
        maximumJobs: 5,
        leaseDurationMs: 60_000,
        databaseUrl: "postgres://synthetic.invalid/test"
      },
      dependencies as never
    );

    expect(result).toEqual({ archivesScanned: 1, leased: 1, completed: 1, failed: 0 });
    expect(dependencies.processIntegrationSyncRun).toHaveBeenCalledWith("run-1", {
      archiveId: "archive-synthetic",
      databaseUrl: "postgres://synthetic.invalid/test"
    });
    expect(dependencies.completeJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1", leaseToken: "lease-1" }),
      expect.objectContaining({ archiveId: "archive-synthetic" })
    );
  });

  it("persists only a public error classification while retaining retry semantics", async () => {
    const lease = leasedJob("job-secret", "run-secret", "lease-secret");
    const dependencies = {
      listArchiveIds: vi.fn(async () => ["archive-synthetic"]),
      leaseNextJob: vi.fn().mockResolvedValueOnce(lease).mockResolvedValueOnce(null),
      processIntegrationSyncRun: vi.fn(async () => {
        throw new Error("postgres://private-user:private-password@db.internal/private-family");
      }),
      completeJob: vi.fn(),
      failJob: vi.fn(async () => ({ ...lease, state: "queued" }))
    };

    const result = await runIntegrationWorkerBatch(
      {
        workerId: "worker-test",
        maximumJobs: 1,
        leaseDurationMs: 60_000,
        databaseUrl: "postgres://synthetic.invalid/test"
      },
      dependencies as never
    );

    expect(result).toEqual({ archivesScanned: 1, leased: 1, completed: 0, failed: 1 });
    expect(dependencies.failJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-secret",
        leaseToken: "lease-secret",
        publicErrorCode: "source_package_invalid",
        retryAt: expect.any(Date)
      }),
      expect.any(Object)
    );
    expect(JSON.stringify(result)).not.toMatch(/private-password|private-family/);
  });

  it("parses bounded hosted and long-running worker settings without accepting zero or negative values", () => {
    expect(integrationWorkerConfiguration({
      DATABASE_URL: "postgres://synthetic.invalid/test",
      KINRESOLVE_WORKER_ID: "worker-hosted",
      KINRESOLVE_WORKER_MAX_JOBS_PER_RUN: "7",
      KINRESOLVE_WORKER_LEASE_DURATION_MS: "90000",
      KINRESOLVE_WORKER_POLL_INTERVAL_MS: "2500"
    })).toEqual({
      databaseUrl: "postgres://synthetic.invalid/test",
      workerId: "worker-hosted",
      maximumJobs: 7,
      leaseDurationMs: 90_000,
      pollIntervalMs: 2_500
    });

    expect(() => integrationWorkerConfiguration({
      DATABASE_URL: "postgres://synthetic.invalid/test",
      KINRESOLVE_WORKER_MAX_JOBS_PER_RUN: "0"
    })).toThrow(/positive|maximum/i);
  });
});

function leasedJob(id: string, runId: string, leaseToken: string) {
  const now = new Date("2026-07-14T20:00:00.000Z");
  return {
    id,
    archiveId: "archive-synthetic",
    kind: "integration_snapshot_parse",
    payload: { runId },
    state: "running" as const,
    idempotencyKey: `parse:${runId}`,
    attempt: 1,
    maximumAttempts: 3,
    availableAt: now,
    leaseOwner: "worker-test",
    leaseToken,
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    updatedAt: now
  };
}
