import { after, type NextRequest } from "next/server";

import { publicBetaErrorResponse } from "@/lib/beta-api-errors";
import {
  betaErrorResponse,
  betaJsonResponse,
  evaluateBetaRateLimits,
  readBetaJsonBody
} from "@/lib/beta-api-http";
import { betaVerificationReissueSchema } from "@/lib/beta-api-schemas";
import { createApiRequestId } from "@/lib/api-response";
import { createBetaEmailDeliveries } from "@/lib/beta-email-delivery";
import { reissueBetaEmailVerification } from "@/lib/beta-invitations";
import { isHostedDeployment } from "@/lib/hosted-config";
import { getArchiveId } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const requestId = createApiRequestId();
  try {
    if (!isHostedDeployment()) return betaErrorResponse(404, "Not found", { requestId });
  } catch {
    return betaErrorResponse(503, "Private beta onboarding is unavailable.", { requestId });
  }

  let input: ReturnType<typeof betaVerificationReissueSchema.parse>;
  try {
    input = betaVerificationReissueSchema.parse(await readBetaJsonBody(request));
  } catch {
    return betaErrorResponse(400, "Verification could not be requested.", { requestId });
  }

  try {
    const limit = await evaluateBetaRateLimits(request, [{
      maximumRequests: 3,
      scope: "beta:email-verification-reissue:email",
      subject: `email:${input.email.trim().toLowerCase()}`,
      windowSeconds: 60 * 60
    }]);
    if (!limit.allowed) {
      return betaErrorResponse(429, "Too many requests. Try again later.", {
        requestId,
        retryAfterSeconds: limit.retryAfterSeconds
      });
    }
    // Run all existence-dependent database and provider work after the fixed
    // response so eligible and unknown addresses have the same observable
    // request path and do not become a timing oracle.
    after(async () => {
      try {
        const email = createBetaEmailDeliveries();
        await reissueBetaEmailVerification({
          appBaseUrl: email.appBaseUrl,
          deliver: email.deliverVerification,
          email: input.email,
          requestId
        }, { archiveId: getArchiveId() });
      } catch {
        // Delivery and account state remain private. Operational audit state is
        // written by the service whenever a matching account reaches it.
      }
    });
    return betaJsonResponse({
      message: "If an eligible account matches that email, a verification message will arrive shortly.",
      requested: true
    }, { requestId, status: 202 });
  } catch (error) {
    return publicBetaErrorResponse(error, "reissue-verification", requestId);
  }
}
