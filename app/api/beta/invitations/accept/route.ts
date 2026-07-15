import type { NextRequest } from "next/server";

import { publicBetaErrorResponse } from "@/lib/beta-api-errors";
import {
  betaErrorResponse,
  betaJsonResponse,
  evaluateBetaRateLimits,
  readBetaJsonBody
} from "@/lib/beta-api-http";
import { betaInvitationAcceptanceSchema } from "@/lib/beta-api-schemas";
import { createApiRequestId } from "@/lib/api-response";
import { createBetaEmailDeliveries } from "@/lib/beta-email-delivery";
import { acceptBetaInvitation } from "@/lib/beta-invitations";
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

  let body: ReturnType<typeof betaInvitationAcceptanceSchema.parse>;
  try {
    body = betaInvitationAcceptanceSchema.parse(await readBetaJsonBody(request));
  } catch {
    return betaErrorResponse(400, "The invitation is invalid, expired, or unavailable.", { requestId });
  }

  try {
    const limit = await evaluateBetaRateLimits(request, [
      {
        maximumRequests: 6,
        scope: "beta:invitation-accept:token",
        subject: `invite-token:${body.token}`,
        windowSeconds: 30 * 60
      },
      {
        maximumRequests: 5,
        scope: "beta:invitation-accept:email",
        subject: `email:${body.email.trim().toLowerCase()}`,
        windowSeconds: 60 * 60
      }
    ]);
    if (!limit.allowed) {
      return betaErrorResponse(429, "Too many requests. Try again later.", {
        requestId,
        retryAfterSeconds: limit.retryAfterSeconds
      });
    }
    const email = createBetaEmailDeliveries();
    const result = await acceptBetaInvitation({
      appBaseUrl: email.appBaseUrl,
      deliverVerification: email.deliverVerification,
      email: body.email,
      legalAcceptance: body.acceptance,
      name: body.name,
      password: body.password,
      requestId,
      token: body.token
    }, { archiveId: getArchiveId() });
    return betaJsonResponse({
      purpose: result.purpose,
      role: result.role,
      verificationDelivery: result.verificationDelivery,
      verificationRequired: true
    }, { requestId, status: 202 });
  } catch (error) {
    return publicBetaErrorResponse(error, "accept", requestId);
  }
}
