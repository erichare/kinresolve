import { describe, expect, it } from "vitest";

import {
  decidePublicDemoAdmission,
  isPublicDemoSessionActive,
  publicDemoSessionPolicy,
  rotatePublicDemoSession
} from "@/lib/public-demo-sessions";

const now = new Date("2026-07-16T16:00:00.000Z");
const expiry = new Date("2026-07-17T16:00:00.000Z");

const activeSession = {
  sessionId: "demo-session-existing",
  status: "active" as const,
  archiveId: "demo-archive-existing",
  tokenDigest: "a".repeat(64),
  generation: 1,
  resetCount: 0,
  aiAttemptsUsed: 2,
  createdAt: now,
  expiresAt: expiry
};

describe("public demo session lifecycle policy", () => {
  it("counts provisioning sessions against the 25-session capacity", () => {
    expect(publicDemoSessionPolicy).toEqual({
      maximumActiveSessions: 25,
      sessionDurationMs: 86_400_000,
      maximumResets: 5,
      aiAttemptsPerSession: 3
    });

    expect(decidePublicDemoAdmission({
      now,
      currentSession: null,
      activeSessionCount: 25,
      provisioningSessionCount: 0,
      create: {
        sessionId: "demo-session-26",
        archiveId: "demo-archive-26",
        tokenDigest: "b".repeat(64)
      }
    })).toEqual({ kind: "capacity-exceeded", maximumActiveSessions: 25 });

    expect(decidePublicDemoAdmission({
      now,
      currentSession: null,
      activeSessionCount: 24,
      provisioningSessionCount: 1,
      create: {
        sessionId: "demo-session-26",
        archiveId: "demo-archive-26",
        tokenDigest: "b".repeat(64)
      }
    })).toEqual({ kind: "capacity-exceeded", maximumActiveSessions: 25 });
  });

  it("admits the twenty-fifth session with a fixed 24-hour expiry", () => {
    const decision = decidePublicDemoAdmission({
      now,
      currentSession: null,
      activeSessionCount: 24,
      provisioningSessionCount: 0,
      create: {
        sessionId: "demo-session-25",
        archiveId: "demo-archive-25",
        tokenDigest: "b".repeat(64)
      }
    });

    expect(decision).toEqual({
      kind: "create",
      session: {
        sessionId: "demo-session-25",
        status: "provisioning",
        archiveId: "demo-archive-25",
        tokenDigest: "b".repeat(64),
        generation: 1,
        resetCount: 0,
        aiAttemptsUsed: 0,
        createdAt: now,
        expiresAt: expiry
      }
    });
  });

  it("resumes an existing active session idempotently even while capacity is full", () => {
    const decision = decidePublicDemoAdmission({
      now,
      currentSession: activeSession,
      activeSessionCount: 25,
      provisioningSessionCount: 0,
      create: {
        sessionId: "must-not-be-used",
        archiveId: "must-not-be-used",
        tokenDigest: "b".repeat(64)
      }
    });

    expect(decision).toEqual({ kind: "resume", session: activeSession });
  });

  it("uses an absolute expiry boundary rather than sliding activity", () => {
    expect(isPublicDemoSessionActive(activeSession, new Date(expiry.getTime() - 1))).toBe(true);
    expect(isPublicDemoSessionActive(activeSession, expiry)).toBe(false);
    expect(isPublicDemoSessionActive(activeSession, new Date(expiry.getTime() + 1))).toBe(false);
  });

  it("rotates the archive generation and token without extending expiry or replenishing AI", () => {
    const resetAt = new Date("2026-07-16T20:00:00.000Z");
    const result = rotatePublicDemoSession(
      activeSession,
      {
        archiveId: "demo-archive-reset",
        tokenDigest: "c".repeat(64)
      },
      resetAt
    );

    expect(result).toEqual({
      session: {
        ...activeSession,
        status: "provisioning",
        archiveId: "demo-archive-reset",
        tokenDigest: "c".repeat(64),
        generation: 2,
        resetCount: 1
      },
      revokedTokenDigest: "a".repeat(64),
      retiredArchive: {
        archiveId: "demo-archive-existing",
        generation: 1,
        retiredAt: resetAt
      }
    });
    expect(result.session.expiresAt).toBe(expiry);
    expect(result.session.aiAttemptsUsed).toBe(2);
  });

  it("rejects reset after absolute expiry or after five rotations", () => {
    expect(() => rotatePublicDemoSession(
      activeSession,
      { archiveId: "demo-archive-late", tokenDigest: "d".repeat(64) },
      expiry
    )).toThrow(/expired/i);

    expect(() => rotatePublicDemoSession(
      { ...activeSession, resetCount: 5 },
      { archiveId: "demo-archive-sixth", tokenDigest: "e".repeat(64) },
      now
    )).toThrow(/reset limit/i);
  });
});
