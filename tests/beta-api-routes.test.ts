import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accept: vi.fn(),
  after: vi.fn(),
  createEmail: vi.fn(),
  inspect: vi.fn(),
  rateLimit: vi.fn(),
  reissue: vi.fn(),
  verify: vi.fn()
}));

vi.mock("next/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("next/server")>();
  return { ...original, after: mocks.after };
});

vi.mock("@/lib/beta-invitations", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/beta-invitations")>();
  return {
    ...original,
    acceptBetaInvitation: mocks.accept,
    inspectBetaInvitation: mocks.inspect,
    reissueBetaEmailVerification: mocks.reissue,
    verifyBetaEmail: mocks.verify
  };
});
vi.mock("@/lib/beta-email-delivery", () => ({ createBetaEmailDeliveries: mocks.createEmail }));
vi.mock("@/lib/beta-api-http", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/beta-api-http")>();
  return { ...original, evaluateBetaRateLimits: mocks.rateLimit };
});
vi.mock("@/lib/hosted-config", () => ({ isHostedDeployment: () => true }));
vi.mock("@/lib/workspace-store", () => ({ getArchiveId: () => "pilot-archive" }));

import { POST as acceptInvitation } from "@/app/api/beta/invitations/accept/route";
import { POST as inspectInvitation } from "@/app/api/beta/invitations/inspect/route";
import { POST as reissueVerification } from "@/app/api/beta/email-verification/reissue/route";
import { POST as verifyEmail } from "@/app/api/beta/email-verification/verify/route";
import { BetaInvitationError } from "@/lib/beta-invitations";

const token = "a".repeat(43);
const legal = {
  accepted: true,
  participationTermsVersion: "terms-v1",
  participationTermsSha256: "a".repeat(64),
  participationTermsUrl: "https://kinresolve.com/legal/terms",
  privacyNoticeVersion: "privacy-v1",
  privacyNoticeSha256: "b".repeat(64),
  privacyNoticeUrl: "https://kinresolve.com/legal/privacy",
  betaBoundaryVersion: "boundary-v1",
  betaBoundarySha256: "c".repeat(64),
  betaBoundaryUrl: "https://kinresolve.com/legal/boundary"
} as const;

function request(path: string, body: unknown): NextRequest {
  return new NextRequest(`https://app.kinresolve.com${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST"
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.after.mockImplementation(() => undefined);
  mocks.createEmail.mockReturnValue({
    appBaseUrl: "https://app.kinresolve.com",
    deliverInvitation: vi.fn(),
    deliverVerification: vi.fn()
  });
});

describe("private-beta public API routes", () => {
  it("inspects an invitation through a no-store, request-identified response", async () => {
    mocks.inspect.mockResolvedValue({
      archiveName: "Pilot workspace",
      expiresAt: new Date("2026-07-16T12:00:00.000Z"),
      legal: {
        status: "approved",
        participationTerms: { title: "Terms", version: "terms-v1", sha256: "a".repeat(64), url: legal.participationTermsUrl },
        privacyNotice: { title: "Privacy", version: "privacy-v1", sha256: "b".repeat(64), url: legal.privacyNoticeUrl },
        betaBoundary: { title: "Boundary", version: "boundary-v1", sha256: "c".repeat(64), url: legal.betaBoundaryUrl }
      },
      purpose: "initial-owner",
      role: "owner"
    });

    const response = await inspectInvitation(request("/api/beta/invitations/inspect", { token }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.inspect).toHaveBeenCalledWith({ token }, { archiveId: "pilot-archive" });
  });

  it("returns only the safe delivery outcome with exact legal acceptance", async () => {
    mocks.accept.mockResolvedValue({
      archiveId: "pilot-archive",
      purpose: "initial-owner",
      role: "owner",
      verificationDelivery: "failed",
      verificationRequired: true
    });

    const response = await acceptInvitation(request("/api/beta/invitations/accept", {
      token,
      name: "Pilot Researcher",
      email: "pilot@example.com",
      password: "correct-horse-battery-staple",
      acceptance: legal
    }));
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(payload).toEqual({
      purpose: "initial-owner",
      role: "owner",
      verificationDelivery: "failed",
      verificationRequired: true
    });
    expect(JSON.stringify(payload)).not.toMatch(/pilot@example|correct-horse|a{43}/);
    expect(mocks.accept.mock.calls[0][0]).toMatchObject({
      appBaseUrl: "https://app.kinresolve.com",
      legalAcceptance: legal,
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/)
    });
  });

  it("verifies a stateful token and returns only the transition", async () => {
    mocks.verify.mockResolvedValue({ verified: true });
    const response = await verifyEmail(request("/api/beta/email-verification/verify", { token }));
    expect(await response.json()).toEqual({ verified: true });
    expect(mocks.verify.mock.calls[0][0]).toMatchObject({ token, requestId: expect.any(String) });
  });

  it("returns the same generic reissue response for an eligible or unknown email", async () => {
    mocks.reissue.mockResolvedValue({ requested: true });
    const response = await reissueVerification(request(
      "/api/beta/email-verification/reissue",
      { email: "unknown@example.com" }
    ));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      message: "If an eligible account matches that email, a verification message will arrive shortly.",
      requested: true
    });
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.reissue).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.reissue).toHaveBeenCalledOnce();
  });

  it("rate-limits before invitation inspection and never reflects a service cause", async () => {
    mocks.rateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 91 });
    const limited = await inspectInvitation(request("/api/beta/invitations/inspect", { token }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("91");
    expect(mocks.inspect).not.toHaveBeenCalled();

    mocks.rateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.inspect.mockRejectedValue(new BetaInvitationError("INVITATION_UNAVAILABLE", {
      cause: new Error("raw-token private-email family-content")
    }));
    const unavailable = await inspectInvitation(request("/api/beta/invitations/inspect", { token }));
    expect(unavailable.status).toBe(400);
    expect(await unavailable.text()).not.toMatch(/raw-token|private-email|family-content/);
  });
});
