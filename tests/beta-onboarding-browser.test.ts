import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  betaActionTokenFromFragment,
  betaLegalAcceptanceFromInspection,
  betaRequestIdFromResponse,
  betaVerificationDeliveryFromAcceptance,
  parseBetaInvitationInspection
} from "@/lib/beta-onboarding-browser";
import { isRetryableBrowserActionStatus } from "@/lib/browser-action-retry";

const legalDocument = (title: string, seed: string) => ({
  title,
  version: `${seed}-v1`,
  sha256: seed.repeat(64).slice(0, 64),
  url: `https://kinresolve.com/legal/${seed}`
});

const inspectionPayload = {
  archiveName: "Private beta workspace",
  role: "owner",
  purpose: "initial-owner",
  expiresAt: "2026-07-16T12:00:00.000Z",
  legal: {
    participationTerms: legalDocument("Participation terms", "a"),
    privacyNotice: legalDocument("Privacy notice", "b"),
    betaBoundary: legalDocument("Beta boundary", "c")
  },
  familyRecords: [{ name: "must not enter state" }],
  invitedEmail: "must-not-enter-state@example.test"
};

describe("beta onboarding browser boundary", () => {
  it("accepts only a canonical response request ID for support", () => {
    expect(betaRequestIdFromResponse(new Response(null, {
      headers: { "x-request-id": "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" }
    }))).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(betaRequestIdFromResponse(new Response(null, {
      headers: { "x-request-id": "private-token-or-provider-value" }
    }))).toBeNull();
    expect(betaRequestIdFromResponse(new Response())).toBeNull();
  });

  it.each([423, 429, 500, 503, 599])("retains a browser capability for retryable HTTP %s", (status) => {
    expect(isRetryableBrowserActionStatus(status)).toBe(true);
  });

  it.each([200, 400, 401, 404, 409, 499, 600])("closes a browser capability for terminal HTTP %s", (status) => {
    expect(isRetryableBrowserActionStatus(status)).toBe(false);
  });

  it("projects only the safe invitation verification-delivery outcome", () => {
    expect(betaVerificationDeliveryFromAcceptance({
      verificationDelivery: "sent",
      rawEmail: "must-not-enter-state@example.test"
    })).toBe("sent");
    expect(betaVerificationDeliveryFromAcceptance({ verificationDelivery: "failed" })).toBe("failed");
    expect(betaVerificationDeliveryFromAcceptance({ verificationDelivery: "provider-secret" })).toBe("failed");
    expect(betaVerificationDeliveryFromAcceptance(null)).toBe("failed");
  });

  it("accepts only one exact base64url token in a fragment", () => {
    const token = "invite_abcdefghijklmnopqrstuvwxyz123456";
    expect(betaActionTokenFromFragment(`#token=${token}`)).toBe(token);
  });

  it.each([
    "",
    "token=invite_abcdefghijklmnopqrstuvwxyz123456",
    "?token=invite_abcdefghijklmnopqrstuvwxyz123456",
    "#token=short",
    "#token=contains%20space1234567890",
    "#token=valid_token_123456789&next=/app",
    "#token=valid_token_123456789&token=second_token_123456789"
  ])("rejects a non-fragment or ambiguous capability: %s", (value) => {
    expect(betaActionTokenFromFragment(value)).toBeNull();
  });

  it("projects only the safe invitation preview fields", () => {
    const result = parseBetaInvitationInspection(inspectionPayload);

    expect(result).toEqual({
      archiveName: inspectionPayload.archiveName,
      role: inspectionPayload.role,
      purpose: inspectionPayload.purpose,
      expiresAt: inspectionPayload.expiresAt,
      legal: inspectionPayload.legal
    });
    expect(JSON.stringify(result)).not.toContain("must not enter state");
    expect(JSON.stringify(result)).not.toContain("must-not-enter-state@example.test");
  });

  it("rejects unsafe legal URLs, invalid roles, hashes, and timestamps", () => {
    expect(parseBetaInvitationInspection({
      ...inspectionPayload,
      legal: {
        ...inspectionPayload.legal,
        privacyNotice: { ...inspectionPayload.legal.privacyNotice, url: "javascript:alert(1)" }
      }
    })).toBeNull();
    expect(parseBetaInvitationInspection({ ...inspectionPayload, role: "superuser" })).toBeNull();
    expect(parseBetaInvitationInspection({ ...inspectionPayload, expiresAt: "not-a-date" })).toBeNull();
    expect(parseBetaInvitationInspection({
      ...inspectionPayload,
      legal: {
        ...inspectionPayload.legal,
        betaBoundary: { ...inspectionPayload.legal.betaBoundary, sha256: "too-short" }
      }
    })).toBeNull();
  });

  it("builds exact version and checksum acceptance metadata", () => {
    const inspection = parseBetaInvitationInspection(inspectionPayload);
    expect(inspection).not.toBeNull();

    expect(betaLegalAcceptanceFromInspection(inspection!)).toEqual({
      accepted: true,
      participationTermsVersion: inspectionPayload.legal.participationTerms.version,
      participationTermsSha256: inspectionPayload.legal.participationTerms.sha256,
      participationTermsUrl: inspectionPayload.legal.participationTerms.url,
      privacyNoticeVersion: inspectionPayload.legal.privacyNotice.version,
      privacyNoticeSha256: inspectionPayload.legal.privacyNotice.sha256,
      privacyNoticeUrl: inspectionPayload.legal.privacyNotice.url,
      betaBoundaryVersion: inspectionPayload.legal.betaBoundary.version,
      betaBoundarySha256: inspectionPayload.legal.betaBoundary.sha256,
      betaBoundaryUrl: inspectionPayload.legal.betaBoundary.url
    });
  });
});

describe("beta onboarding source contracts", () => {
  const invitationSource = source("components/beta-invitation-form.tsx");
  const verificationSource = source("components/beta-email-verification.tsx");
  const invitePageSource = source("app/invite/page.tsx");
  const verifyPageSource = source("app/verify-email/page.tsx");

  it.each([invitationSource, verificationSource])("reads only the fragment and immediately scrubs browser history", (contents) => {
    expect(contents).toContain("betaActionTokenFromFragment(window.location.hash)");
    expect(contents).toContain('window.history.replaceState(window.history.state, "", window.location.pathname)');
    expect(contents).not.toContain("window.location.search");
    expect(contents).not.toMatch(/console\.(?:log|info|warn|error)/);
  });

  it("uses no-store POSTs for invitation inspection and acceptance", () => {
    expect(invitationSource).toContain('fetch("/api/beta/invitations/inspect"');
    expect(invitationSource).toContain('fetch("/api/beta/invitations/accept"');
    expect(invitationSource.match(/method: "POST"/g)).toHaveLength(2);
    expect(invitationSource.match(/cache: "no-store"/g)).toHaveLength(2);
    expect(invitationSource).toContain("acceptance: betaLegalAcceptanceFromInspection(inspection)");
    expect(invitationSource).toMatch(/checked=\{accepted\}[\s\S]*required[\s\S]*type="checkbox"/);
  });

  it("retains invitation capabilities across retryable responses and exposes retry controls", () => {
    expect(invitationSource).toContain("isRetryableBrowserActionStatus(response.status)");
    expect(invitationSource).toContain('setStatus("inspection-retryable")');
    expect(invitationSource).toContain('setStatus("accept-retryable")');
    expect(invitationSource).toContain("Try checking again");
    expect(invitationSource).toContain("Try accepting again");
  });

  it("shows an honest verification recovery path when delivery fails", () => {
    expect(invitationSource).toContain("betaVerificationDeliveryFromAcceptance");
    expect(invitationSource).toContain('verificationDelivery === "sent"');
    expect(invitationSource).toContain('href="/resend-verification"');
    expect(invitationSource).toContain("we could not send the verification email");
  });

  it("uses a no-store verification POST and never interpolates the token into a URL", () => {
    expect(verificationSource).toContain('fetch("/api/beta/email-verification/verify"');
    expect(verificationSource).toContain('method: "POST"');
    expect(verificationSource).toContain('cache: "no-store"');
    expect(verificationSource).toContain("body: JSON.stringify({ token })");
    expect(verificationSource).not.toMatch(/(?:href|assign|replace|push)\s*\([^)]*token/);
  });

  it("retains the verification capability and exposes an explicit retry action for temporary failures", () => {
    expect(verificationSource).toContain("isRetryableBrowserActionStatus(response.status)");
    expect(verificationSource).toContain('setStatus("retryable")');
    expect(verificationSource).toContain("Try verification again");
  });

  it("keeps both token pages out of search and server props", () => {
    for (const contents of [invitePageSource, verifyPageSource]) {
      expect(contents).toMatch(/robots:\s*\{ index: false, follow: false \}/);
      expect(contents).not.toContain("searchParams");
    }
  });
});

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}
