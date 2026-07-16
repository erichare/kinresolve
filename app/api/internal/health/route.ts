import { NextResponse } from "next/server";

import { readJobLagHealth, readWorkerFreshness } from "@/lib/beta-operations";
import { deploymentReleaseCommitSha } from "@/lib/observability";
import { authenticateObservabilityProbe } from "@/lib/observability-probe";
import { publicDemoEnabled } from "@/lib/public-demo-config";
import { readPublicDemoDiagnostics } from "@/lib/public-demo-session-store";
import { getRuntimeStatus, isRuntimeReady } from "@/lib/runtime-status";
import { getArchiveId } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!authenticateObservabilityProbe(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }

  const status = await getRuntimeStatus();
  const ready = isRuntimeReady(status);
  let workers: Awaited<ReturnType<typeof readWorkerFreshness>> | null = null;
  let jobLag: Awaited<ReturnType<typeof readJobLagHealth>> | null = null;
  let publicDemo: ReturnType<typeof projectPublicDemoDiagnostics> | null = null;
  let demoEnabled = false;
  let demoConfigurationValid = true;
  try {
    demoEnabled = publicDemoEnabled();
  } catch {
    demoConfigurationValid = false;
  }
  try {
    const [workerState, lagState, demoState] = await Promise.all([
      readWorkerFreshness({ archiveId: getArchiveId() }),
      readJobLagHealth({ archiveId: getArchiveId() }),
      demoEnabled ? readPublicDemoDiagnostics() : Promise.resolve(null)
    ]);
    workers = workerState;
    jobLag = lagState;
    publicDemo = demoState ? projectPublicDemoDiagnostics(demoState) : null;
  } catch {
    // Database readiness already fails closed above. Do not surface connection
    // details or an exception through the protected probe either.
  }

  const operationallyReady = ready
    && demoConfigurationValid
    && (!demoEnabled || publicDemo !== null);

  return NextResponse.json(
    {
      status: operationallyReady ? "ok" : "degraded",
      product: status.product,
      version: status.version,
      releaseCommitSha: deploymentReleaseCommitSha(),
      database: {
        configured: status.database.configured,
        connected: status.database.connected,
        identityConfigured: status.database.identityConfigured,
        identity: status.database.identity,
        identityMatchesConfigured: status.database.identityMatchesConfigured,
        transportVerified: status.database.transportVerified,
        provisioned: status.database.provisioned,
        datasetMode: status.database.datasetMode,
        expectedDatasetMode: status.database.expectedDatasetMode,
        datasetModeMatches: status.database.datasetModeMatches,
        demoFixtureVersion: status.database.demoFixtureVersion
      },
      ai: {
        enabled: status.ai.enabled,
        configured: status.ai.configured
      },
      api: status.api,
      capabilities: status.capabilities,
      scheduledWrites: status.scheduledWrites,
      storage: {
        configured: status.storage.configured,
        identityConfigured: status.storage.identityConfigured,
        identityVerified: status.storage.identityVerified
      },
      workers,
      jobLag,
      publicDemo
    },
    {
      status: operationallyReady ? 200 : 503,
      headers: { "cache-control": "no-store" }
    }
  );
}

function projectPublicDemoDiagnostics(
  diagnostics: Awaited<ReturnType<typeof readPublicDemoDiagnostics>>
) {
  const occupied = diagnostics.capacity.active + diagnostics.capacity.provisioning;
  return {
    capacity: {
      maximum: diagnostics.capacity.maximum,
      active: diagnostics.capacity.active,
      provisioning: diagnostics.capacity.provisioning,
      occupied
    },
    cleanup: {
      lastCompletedAt: diagnostics.cleanup.lastCompletedAt,
      freshness: cleanupFreshness(diagnostics.cleanup.lastCompletedAt)
    },
    staleProvisioning: diagnostics.cleanup.staleProvisioning,
    aiBudget: {
      concurrentLimit: diagnostics.ai.maximumConcurrent,
      running: diagnostics.ai.running,
      dailyLimit: diagnostics.ai.maximumDaily,
      dailyUsed: diagnostics.ai.usedToday
    }
  };
}

function cleanupFreshness(lastCompletedAt: string | null): "healthy" | "missing" | "stale" {
  if (!lastCompletedAt) return "missing";
  const completedAt = Date.parse(lastCompletedAt);
  if (!Number.isFinite(completedAt)) return "stale";
  return Date.now() - completedAt <= 10 * 60 * 1000 ? "healthy" : "stale";
}
