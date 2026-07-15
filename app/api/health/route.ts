import { NextResponse } from "next/server";
import { getRuntimeStatus } from "@/lib/runtime-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const status = await getRuntimeStatus();
  const ready =
    status.capabilities.valid &&
    status.scheduledWrites.valid &&
    status.database.connected &&
    status.database.provisioned &&
    status.database.datasetModeMatches &&
    (status.capabilities.deploymentMode !== "hosted" || (
      status.database.identityConfigured &&
      status.database.identityMatchesConfigured &&
      status.database.transportVerified
    )) &&
    status.storage.configured &&
    (status.capabilities.deploymentMode !== "hosted" || (
      status.storage.identityConfigured && status.storage.identityVerified
    ));

  return NextResponse.json(
    {
      status: ready ? "ok" : "degraded",
      product: status.product,
      version: status.version,
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
      capabilities: status.capabilities,
      scheduledWrites: status.scheduledWrites,
      storage: {
        configured: status.storage.configured,
        identityConfigured: status.storage.identityConfigured,
        identityVerified: status.storage.identityVerified
      }
    },
    { status: ready ? 200 : 503 }
  );
}
