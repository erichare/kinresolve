import type { NextRequest } from "next/server";

import { betaErrorResponse, betaJsonResponse } from "@/lib/beta-api-http";
import { createApiRequestId } from "@/lib/api-response";
import { createBetaEmailDeliveries } from "@/lib/beta-email-delivery";
import {
  BetaInvitationError,
  cleanupBetaInvitationState,
  issueBetaInvitation,
  revokeAllPendingBetaInvitations,
  revokeBetaInvitation,
  setBetaInvitationControl,
  type BetaInvitationServiceOptions
} from "@/lib/beta-invitations";
import { isHostedDeployment } from "@/lib/hosted-config";
import { operatorInvitationCommandSchema } from "@/lib/operator-api-schemas";
import { authenticateOperatorRequest } from "@/lib/operator-request";
import { getActiveReleaseFence } from "@/lib/release-fence";
import { releaseFenceLockedResponse } from "@/lib/release-fence-http";
import { getArchiveId } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const requestId = createApiRequestId();
  let authenticated: Awaited<ReturnType<typeof authenticateOperatorRequest>>;
  try {
    authenticated = await authenticateOperatorRequest(request);
  } catch {
    return betaErrorResponse(401, "Unauthorized", { requestId });
  }

  try {
    if (!isHostedDeployment()) return betaErrorResponse(404, "Not found", { requestId });
    const activeFence = await getActiveReleaseFence();
    if (activeFence) {
      return releaseFenceLockedResponse(activeFence, { discloseControlIdentity: true });
    }
  } catch {
    return betaErrorResponse(503, "Operator safety check unavailable.", { requestId });
  }

  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return betaErrorResponse(400, "The operator request is invalid.", { requestId });
  }
  let command: ReturnType<typeof operatorInvitationCommandSchema.parse>;
  try {
    command = operatorInvitationCommandSchema.parse(JSON.parse(authenticated.body) as unknown);
  } catch {
    return betaErrorResponse(400, "The operator request is invalid.", { requestId });
  }

  try {
    const options: BetaInvitationServiceOptions = { archiveId: getArchiveId() };
    if (command.action === "issue") {
      const email = createBetaEmailDeliveries();
      const result = await issueBetaInvitation({
        appBaseUrl: email.appBaseUrl,
        deliver: email.deliverInvitation,
        email: command.email,
        expiresInSeconds: command.expiresInSeconds,
        operator: authenticated.claim,
        purpose: command.purpose,
        role: command.role
      }, options);
      return betaJsonResponse(result, { requestId, status: 201 });
    }
    if (command.action === "revoke") {
      return betaJsonResponse(await revokeBetaInvitation({
        invitationId: command.invitationId,
        operator: authenticated.claim
      }, options), { requestId });
    }
    if (command.action === "revoke-all") {
      return betaJsonResponse(await revokeAllPendingBetaInvitations({
        operator: authenticated.claim
      }, options), { requestId });
    }
    if (command.action === "control") {
      return betaJsonResponse(await setBetaInvitationControl({
        operator: authenticated.claim,
        reasonCode: command.reasonCode,
        state: command.state
      }, options), { requestId });
    }
    return betaJsonResponse(await cleanupBetaInvitationState({
      ...(command.limit === undefined ? {} : { limit: command.limit }),
      operator: authenticated.claim
    }, options), { requestId });
  } catch (error) {
    return operatorErrorResponse(error, requestId);
  }
}

function operatorErrorResponse(error: unknown, requestId: string) {
  if (error instanceof BetaInvitationError) {
    if (error.code === "OPERATOR_REPLAY" || error.code === "ACTIVE_INVITATION_EXISTS" || error.code === "INITIAL_OWNER_EXISTS") {
      return betaErrorResponse(409, error.message, { requestId });
    }
    if (error.code === "INVITATIONS_PAUSED") {
      return betaErrorResponse(423, error.message, { requestId });
    }
    if (error.code === "DELIVERY_FAILED") {
      return betaErrorResponse(502, error.message, { requestId });
    }
    if (error.code === "INVALID_INPUT") {
      return betaErrorResponse(400, error.message, { requestId });
    }
  }
  return betaErrorResponse(503, "The operator request could not be completed.", { requestId });
}
