import { BetaInvitationError } from "./beta-invitations";
import { betaErrorResponse } from "./beta-api-http";

export type PublicBetaOperation = "accept" | "inspect" | "reissue-verification" | "verify-email";

export function publicBetaErrorResponse(
  error: unknown,
  operation: PublicBetaOperation,
  requestId: string
) {
  if (error instanceof BetaInvitationError) {
    if (error.code === "INVITATIONS_PAUSED") {
      return betaErrorResponse(423, "Private beta onboarding is temporarily paused.", { requestId });
    }
    if (error.code === "LEGAL_NOT_APPROVED" || error.code === "OPERATION_FAILED") {
      return betaErrorResponse(503, "Private beta onboarding is unavailable.", { requestId });
    }
  }

  const message = operation === "verify-email"
    ? "The verification link is invalid, expired, or unavailable."
    : operation === "reissue-verification"
      ? "Verification could not be requested."
      : "The invitation is invalid, expired, or unavailable.";
  return betaErrorResponse(400, message, { requestId });
}
