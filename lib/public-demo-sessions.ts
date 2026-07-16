export const publicDemoSessionPolicy = {
  maximumActiveSessions: 25,
  sessionDurationMs: 86_400_000,
  maximumResets: 5,
  aiAttemptsPerSession: 3
} as const;

export type PublicDemoSessionStatus = "provisioning" | "active" | "ended" | "expired";

export type PublicDemoSessionState = {
  sessionId: string;
  status: PublicDemoSessionStatus;
  archiveId: string;
  tokenDigest: string;
  generation: number;
  resetCount: number;
  aiAttemptsUsed: number;
  createdAt: Date;
  expiresAt: Date;
};

type AdmissionInput = {
  now: Date;
  currentSession: PublicDemoSessionState | null;
  activeSessionCount: number;
  provisioningSessionCount: number;
  create: Pick<PublicDemoSessionState, "sessionId" | "archiveId" | "tokenDigest">;
};

export type PublicDemoAdmissionDecision =
  | { kind: "resume"; session: PublicDemoSessionState }
  | { kind: "capacity-exceeded"; maximumActiveSessions: 25 }
  | { kind: "create"; session: PublicDemoSessionState };

export function decidePublicDemoAdmission(input: AdmissionInput): PublicDemoAdmissionDecision {
  validateCount(input.activeSessionCount, "active session count");
  validateCount(input.provisioningSessionCount, "provisioning session count");

  if (input.currentSession && isPublicDemoSessionActive(input.currentSession, input.now)) {
    return { kind: "resume", session: input.currentSession };
  }

  if (
    input.activeSessionCount + input.provisioningSessionCount
    >= publicDemoSessionPolicy.maximumActiveSessions
  ) {
    return {
      kind: "capacity-exceeded",
      maximumActiveSessions: publicDemoSessionPolicy.maximumActiveSessions
    };
  }

  validateIdentity(input.create.sessionId, "session ID");
  validateIdentity(input.create.archiveId, "archive ID");
  validateDigest(input.create.tokenDigest);

  return {
    kind: "create",
    session: {
      ...input.create,
      status: "provisioning",
      generation: 1,
      resetCount: 0,
      aiAttemptsUsed: 0,
      createdAt: input.now,
      expiresAt: new Date(input.now.getTime() + publicDemoSessionPolicy.sessionDurationMs)
    }
  };
}

export function isPublicDemoSessionActive(
  session: Pick<PublicDemoSessionState, "status" | "expiresAt">,
  now: Date
): boolean {
  return (
    (session.status === "active" || session.status === "provisioning")
    && session.expiresAt.getTime() > now.getTime()
  );
}

export function rotatePublicDemoSession(
  session: PublicDemoSessionState,
  next: Pick<PublicDemoSessionState, "archiveId" | "tokenDigest">,
  now: Date
): {
  session: PublicDemoSessionState;
  revokedTokenDigest: string;
  retiredArchive: { archiveId: string; generation: number; retiredAt: Date };
} {
  if (!isPublicDemoSessionActive(session, now)) {
    throw new Error("The public demo session has expired.");
  }
  if (session.resetCount >= publicDemoSessionPolicy.maximumResets) {
    throw new Error("The public demo session reset limit has been reached.");
  }
  validateIdentity(next.archiveId, "archive ID");
  validateDigest(next.tokenDigest);
  if (next.archiveId === session.archiveId || next.tokenDigest === session.tokenDigest) {
    throw new Error("A public demo reset must rotate both the archive and session token.");
  }

  return {
    session: {
      ...session,
      status: "provisioning",
      archiveId: next.archiveId,
      tokenDigest: next.tokenDigest,
      generation: session.generation + 1,
      resetCount: session.resetCount + 1
    },
    revokedTokenDigest: session.tokenDigest,
    retiredArchive: {
      archiveId: session.archiveId,
      generation: session.generation,
      retiredAt: now
    }
  };
}

function validateCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`The public demo ${label} is invalid.`);
  }
}

function validateIdentity(value: string, label: string): void {
  if (!value.trim()) throw new Error(`The public demo ${label} is invalid.`);
}

function validateDigest(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("The public demo session token digest is invalid.");
  }
}
