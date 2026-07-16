import { NextResponse } from "next/server";

import { withDemoGuestCapability } from "@/lib/api-authorization";
import { readPublicDemoSessionToken } from "@/lib/public-demo-session-token";
import { readPublicDemoSession } from "@/lib/public-demo-session-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withDemoGuestCapability("demo:session-control", async (request) => {
  const token = readPublicDemoSessionToken(request.headers);
  const session = token ? await readPublicDemoSession(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Demo session required" }, { status: 401 });
  }
  return NextResponse.json({
    session,
    workspaceUrl: "/app/cases/case-mercer-march-identity?guide=1"
  }, { headers: privateHeaders() });
});

function privateHeaders(): HeadersInit {
  return {
    "cache-control": "private, no-store",
    "x-robots-tag": "noindex, nofollow, noarchive"
  };
}
