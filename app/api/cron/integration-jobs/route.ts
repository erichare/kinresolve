import { NextResponse } from "next/server";

import {
  integrationWorkerConfiguration,
  runIntegrationWorkerBatch,
  runIntegrationWorkerMaintenance
} from "@/lib/integrations/worker";
import { logRedactedIntegrationError } from "@/lib/integrations/error-reporting";
import { getActiveReleaseFence } from "@/lib/release-fence";
import { releaseFenceLockedResponse } from "@/lib/release-fence-http";
import { getScheduledWritesStatus } from "@/lib/scheduled-writes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
const hostedWorkerSafetyMarginMs = 30_000;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "Scheduled integration work is not configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scheduledWrites = getScheduledWritesStatus();
  if (!scheduledWrites.valid || !scheduledWrites.enabled) {
    return NextResponse.json({ error: "Scheduled work is unavailable." }, { status: 503 });
  }

  try {
    const activeFence = await getActiveReleaseFence();
    if (activeFence) return releaseFenceLockedResponse(activeFence, { discloseControlIdentity: true });
    const configuration = integrationWorkerConfiguration();
    // Cleanup is independent of parse-queue discovery, so a cron invocation
    // still performs bounded maintenance when there are no jobs or archives
    // waiting to be parsed.
    const [maintenance, result] = await Promise.all([
      runIntegrationWorkerMaintenance({
        databaseUrl: configuration.databaseUrl,
        maintenanceLimit: configuration.maintenanceLimit
      }),
      runIntegrationWorkerBatch({
        databaseUrl: configuration.databaseUrl,
        workerId: configuration.workerId,
        maximumJobs: 1,
        leaseDurationMs: configuration.leaseDurationMs,
        deadlineAt: new Date(Date.now() + maxDuration * 1_000 - hostedWorkerSafetyMarginMs),
        ...(configuration.malwareScanner ? { malwareScanner: configuration.malwareScanner } : {})
      })
    ]);
    return NextResponse.json({ ...result, maintenance });
  } catch (error) {
    logRedactedIntegrationError("integration_worker_error", error);
    return NextResponse.json({ error: "Scheduled integration work failed." }, { status: 500 });
  }
}
