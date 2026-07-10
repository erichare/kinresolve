import { NextResponse } from "next/server";
import { getRuntimeStatus } from "@/lib/runtime-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const status = await getRuntimeStatus();

  return NextResponse.json(
    {
      status: status.database.connected ? "ok" : "degraded",
      product: status.product,
      version: status.version,
      database: {
        configured: status.database.configured,
        connected: status.database.connected
      },
      ai: {
        configured: status.ai.configured
      }
    },
    { status: status.database.connected ? 200 : 503 }
  );
}
