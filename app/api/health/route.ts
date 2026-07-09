import { NextResponse } from "next/server";
import { getRuntimeStatus } from "@/lib/runtime-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const status = await getRuntimeStatus();

  return NextResponse.json(
    {
      status: status.database.connected ? "ok" : "degraded",
      ...status
    },
    { status: status.database.connected ? 200 : 503 }
  );
}
