import type { NextRequest } from "next/server";

import { apiErrorResponse, createApiRequestId } from "@/lib/api-response";
import { getAuth } from "@/lib/auth";
import { notifyHostedSessionsRevoked } from "@/lib/auth-email";
import { getSessionContext } from "@/lib/auth-session";
import { ensureDatabaseSchema } from "@/lib/db";
import { isHostedDeployment } from "@/lib/hosted-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const requestId = createApiRequestId();
  if (!process.env.AUTH_SECRET) return unavailable(requestId);

  try {
    await ensureDatabaseSchema();
    const session = await getSessionContext(request.headers);
    if (!session) {
      return apiErrorResponse(401, "Authentication required", {
        requestId,
        headers: { "cache-control": "private, no-store" }
      });
    }
    if (session.kind === "demo-guest") {
      return apiErrorResponse(403, "Permission denied", {
        requestId,
        headers: { "cache-control": "private, no-store" }
      });
    }

    const result = await getAuth().api.revokeSessions({ headers: request.headers });
    if (result.status !== true) return unavailable(requestId);

    if (isHostedDeployment()) {
      await notifyHostedSessionsRevoked({
        requestId,
        user: { id: session.userId, email: session.email }
      });
    }

    return Response.json({ revoked: true }, {
      status: 200,
      headers: {
        "cache-control": "private, no-store",
        "x-request-id": requestId
      }
    });
  } catch {
    return unavailable(requestId);
  }
}

function unavailable(requestId: string) {
  return apiErrorResponse(503, "Every session could not be confirmed revoked.", {
    requestId,
    headers: { "cache-control": "private, no-store" }
  });
}
