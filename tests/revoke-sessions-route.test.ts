import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureDatabaseSchema: vi.fn(),
  getSessionContext: vi.fn(),
  isHostedDeployment: vi.fn(),
  notifyHostedSessionsRevoked: vi.fn(),
  revokeSessions: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { revokeSessions: mocks.revokeSessions } })
}));
vi.mock("@/lib/auth-email", () => ({
  notifyHostedSessionsRevoked: mocks.notifyHostedSessionsRevoked
}));
vi.mock("@/lib/auth-session", () => ({ getSessionContext: mocks.getSessionContext }));
vi.mock("@/lib/db", () => ({ ensureDatabaseSchema: mocks.ensureDatabaseSchema }));
vi.mock("@/lib/hosted-config", () => ({ isHostedDeployment: mocks.isHostedDeployment }));

import { POST } from "@/app/api/auth/security/revoke-sessions/route";

const request = () => new NextRequest("https://app.kinresolve.com/api/auth/security/revoke-sessions", {
  method: "POST",
  headers: {
    cookie: "better-auth.session_token=private-session-value",
    origin: "https://app.kinresolve.com",
    "sec-fetch-site": "same-origin"
  }
});

const session = {
  userId: "user-beta",
  email: "participant@example.com",
  name: "Participant",
  role: "owner",
  archiveId: "archive-beta"
} as const;

describe("revoke all sessions route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_SECRET", "revoke-sessions-test-secret");
    mocks.ensureDatabaseSchema.mockResolvedValue(undefined);
    mocks.getSessionContext.mockResolvedValue(session);
    mocks.revokeSessions.mockResolvedValue({ status: true });
    mocks.isHostedDeployment.mockReturnValue(true);
    mocks.notifyHostedSessionsRevoked.mockResolvedValue(undefined);
  });

  it("revokes first, then schedules the hosted audit and notification", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ revoked: true });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const requestId = response.headers.get("x-request-id");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.revokeSessions).toHaveBeenCalledOnce();
    expect(mocks.notifyHostedSessionsRevoked).toHaveBeenCalledWith({
      requestId,
      user: { id: "user-beta", email: "participant@example.com" }
    });
    expect(mocks.revokeSessions.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.notifyHostedSessionsRevoked.mock.invocationCallOrder[0]
    );
  });

  it("requires an authorized archive-backed session", async () => {
    mocks.getSessionContext.mockResolvedValue(null);

    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.revokeSessions).not.toHaveBeenCalled();
    expect(mocks.notifyHostedSessionsRevoked).not.toHaveBeenCalled();
  });

  it("never records success or sends mail if Better Auth cannot confirm revocation", async () => {
    mocks.revokeSessions.mockRejectedValue(new Error("private adapter marker"));

    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private adapter marker");
    expect(mocks.notifyHostedSessionsRevoked).not.toHaveBeenCalled();
  });

  it("preserves self-hosted revocation without requiring hosted email", async () => {
    mocks.isHostedDeployment.mockReturnValue(false);

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.revokeSessions).toHaveBeenCalledOnce();
    expect(mocks.notifyHostedSessionsRevoked).not.toHaveBeenCalled();
  });
});
