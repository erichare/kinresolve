import type { PublicDemoSessionView } from "./public-demo-session-store";

export type PublicDemoSessionResponse = Pick<
  PublicDemoSessionView,
  "expiresAt" | "status" | "resetCount" | "aiAttemptsRemaining"
>;

export function projectPublicDemoSession(
  session: PublicDemoSessionView
): PublicDemoSessionResponse {
  return {
    expiresAt: session.expiresAt,
    status: session.status,
    resetCount: session.resetCount,
    aiAttemptsRemaining: session.aiAttemptsRemaining
  };
}
