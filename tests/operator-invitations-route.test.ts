import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  cleanup: vi.fn(),
  consumeOperator: vi.fn(),
  createEmail: vi.fn(),
  deleteApplications: vi.fn(),
  fence: vi.fn(),
  issue: vi.fn(),
  revoke: vi.fn(),
  revokeAll: vi.fn(),
  setControl: vi.fn()
}));

vi.mock("@/lib/operator-request", () => ({ authenticateOperatorRequest: mocks.authenticate }));
vi.mock("@/lib/release-fence", () => ({ getActiveReleaseFence: mocks.fence }));
vi.mock("@/lib/beta-email-delivery", () => ({ createBetaEmailDeliveries: mocks.createEmail }));
vi.mock("@/lib/beta-applications", () => ({
  deleteBetaApplicationsForEmail: mocks.deleteApplications
}));
vi.mock("@/lib/beta-invitations", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/beta-invitations")>();
  return {
    ...original,
    cleanupBetaInvitationState: mocks.cleanup,
    consumeBetaOperatorRequest: mocks.consumeOperator,
    issueBetaInvitation: mocks.issue,
    revokeAllPendingBetaInvitations: mocks.revokeAll,
    revokeBetaInvitation: mocks.revoke,
    setBetaInvitationControl: mocks.setControl
  };
});
vi.mock("@/lib/hosted-config", () => ({ isHostedDeployment: () => true }));
vi.mock("@/lib/workspace-store", () => ({ getArchiveId: () => "pilot-archive" }));

import { POST } from "@/app/api/operator/invitations/route";
import { BetaInvitationError } from "@/lib/beta-invitations";

const claim = {
  keyId: "beta-operator-1",
  nonce: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  requestDigest: "d".repeat(64),
  timestamp: new Date("2026-07-15T18:00:00.000Z")
};

function request(body: unknown): NextRequest {
  const source = JSON.stringify(body);
  const result = new NextRequest("https://app.kinresolve.com/api/operator/invitations", {
    body: source,
    headers: { "content-type": "application/json" },
    method: "POST"
  });
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockImplementation(async (incoming: NextRequest) => ({
    body: await incoming.clone().text(),
    claim
  }));
  mocks.fence.mockResolvedValue(null);
  mocks.consumeOperator.mockResolvedValue(undefined);
  mocks.deleteApplications.mockResolvedValue({ deletedCount: 0 });
  mocks.createEmail.mockReturnValue({
    appBaseUrl: "https://app.kinresolve.com",
    deliverInvitation: vi.fn(),
    deliverVerification: vi.fn()
  });
});

describe("signed beta operator invitation route", () => {
  it("authenticates before checking the release fence", async () => {
    mocks.authenticate.mockRejectedValue(new Error("bad signature"));
    const response = await POST(request({ action: "revoke-all" }));
    expect(response.status).toBe(401);
    expect(mocks.fence).not.toHaveBeenCalled();
  });

  it("issues and delivers an invitation without returning its email or bearer token", async () => {
    mocks.issue.mockResolvedValue({
      archiveId: "pilot-archive",
      expiresAt: new Date("2026-07-16T18:00:00.000Z"),
      invitationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      purpose: "initial-owner",
      role: "owner"
    });
    const response = await POST(request({
      action: "issue",
      email: "pilot@example.com",
      expiresInSeconds: 86_400,
      purpose: "initial-owner",
      role: "owner"
    }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(payload).toMatchObject({
      archiveId: "pilot-archive",
      invitationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      purpose: "initial-owner",
      role: "owner"
    });
    expect(JSON.stringify(payload)).not.toMatch(/pilot@example|token/i);
    expect(mocks.issue.mock.calls[0][0]).toMatchObject({
      appBaseUrl: "https://app.kinresolve.com",
      email: "pilot@example.com",
      operator: claim
    });
  });

  it("maps a replay to a safe conflict", async () => {
    mocks.revokeAll.mockRejectedValue(new BetaInvitationError("OPERATOR_REPLAY", {
      cause: new Error("private body and key")
    }));
    const response = await POST(request({ action: "revoke-all" }));
    expect(response.status).toBe(409);
    expect(await response.text()).not.toMatch(/private body|key$/i);
  });

  it("consumes the signed operator nonce before deleting matching applications", async () => {
    mocks.deleteApplications.mockResolvedValue({ deletedCount: 2 });
    const response = await POST(request({
      action: "application-delete",
      email: "pilot@example.test"
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deletedCount: 2 });
    expect(mocks.consumeOperator).toHaveBeenCalledWith(claim, { archiveId: "pilot-archive" });
    expect(mocks.deleteApplications).toHaveBeenCalledWith(
      "pilot@example.test",
      { archiveId: "pilot-archive" }
    );
    expect(mocks.consumeOperator.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteApplications.mock.invocationCallOrder[0]
    );
  });

  it("rejects non-transport email addresses before consuming or deleting", async () => {
    const response = await POST(request({
      action: "application-delete",
      email: "pilot@例え.test"
    }));

    expect(response.status).toBe(400);
    expect(mocks.consumeOperator).not.toHaveBeenCalled();
    expect(mocks.deleteApplications).not.toHaveBeenCalled();
  });

  it("never reaches a mutation while a release fence is active", async () => {
    mocks.fence.mockResolvedValue({
      activatedAt: new Date("2026-07-15T18:00:00.000Z"),
      activationGeneration: 1,
      fenceId: "fence-beta-release",
      releaseCommitSha: "a".repeat(40),
      state: "active"
    });
    const response = await POST(request({ action: "revoke-all" }));
    expect(response.status).toBe(423);
    expect(mocks.revokeAll).not.toHaveBeenCalled();
  });
});
