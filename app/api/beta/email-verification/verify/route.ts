import type { NextRequest } from "next/server";

import { publicBetaErrorResponse } from "@/lib/beta-api-errors";
import {
  betaErrorResponse,
  betaJsonResponse,
  evaluateBetaRateLimits,
  readBetaJsonBody
} from "@/lib/beta-api-http";
import { betaTokenBodySchema } from "@/lib/beta-api-schemas";
import { createApiRequestId } from "@/lib/api-response";
import { verifyBetaEmail } from "@/lib/beta-invitations";
import { isHostedDeployment } from "@/lib/hosted-config";
import { getArchiveId } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const requestId = createApiRequestId();
  try {
    if (!isHostedDeployment()) return betaErrorResponse(404, "Not found", { requestId });
  } catch {
    return betaErrorResponse(503, "Private beta onboarding is unavailable.", { requestId });
  }

  let input: ReturnType<typeof betaTokenBodySchema.parse>;
  try {
    input = betaTokenBodySchema.parse(await readBetaJsonBody(request));
  } catch {
    return betaErrorResponse(400, "The verification link is invalid, expired, or unavailable.", { requestId });
  }

  try {
    const limit = await evaluateBetaRateLimits(request, [{
      maximumRequests: 8,
      scope: "beta:email-verification:token",
      subject: `verification-token:${input.token}`,
      windowSeconds: 30 * 60
    }]);
    if (!limit.allowed) {
      return betaErrorResponse(429, "Too many requests. Try again later.", {
        requestId,
        retryAfterSeconds: limit.retryAfterSeconds
      });
    }
    const result = await verifyBetaEmail({ requestId, token: input.token }, { archiveId: getArchiveId() });
    return betaJsonResponse(result, { requestId });
  } catch (error) {
    return publicBetaErrorResponse(error, "verify-email", requestId);
  }
}
