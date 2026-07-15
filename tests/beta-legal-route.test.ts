import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evaluateBetaRateLimits: vi.fn(),
  fetchVerifiedBetaLegalDocument: vi.fn(),
  isHostedDeployment: vi.fn()
}));

vi.mock("@/lib/beta-api-http", () => ({ evaluateBetaRateLimits: mocks.evaluateBetaRateLimits }));
vi.mock("@/lib/beta-legal-document-validation", () => ({
  fetchVerifiedBetaLegalDocument: mocks.fetchVerifiedBetaLegalDocument
}));
vi.mock("@/lib/hosted-config", () => ({ isHostedDeployment: mocks.isHostedDeployment }));

import { GET } from "@/app/api/beta/legal/[document]/route";

const legalEnvironment = {
  KINRESOLVE_BETA_LEGAL_STATUS: "approved",
  KINRESOLVE_BETA_PARTICIPATION_TERMS_VERSION: "terms-v1",
  KINRESOLVE_BETA_PARTICIPATION_TERMS_SHA256: "a".repeat(64),
  KINRESOLVE_BETA_PARTICIPATION_TERMS_URL: "https://kinresolve.com/legal/private-beta-terms",
  KINRESOLVE_BETA_PRIVACY_NOTICE_VERSION: "privacy-v1",
  KINRESOLVE_BETA_PRIVACY_NOTICE_SHA256: "b".repeat(64),
  KINRESOLVE_BETA_PRIVACY_NOTICE_URL: "https://kinresolve.com/legal/private-beta-privacy",
  KINRESOLVE_BETA_BOUNDARY_VERSION: "boundary-v1",
  KINRESOLVE_BETA_BOUNDARY_SHA256: "c".repeat(64),
  KINRESOLVE_BETA_BOUNDARY_URL: "https://kinresolve.com/legal/private-beta-boundary"
} as const;

function request(document = "privacy-notice") {
  return new NextRequest(`https://app.kinresolve.com/api/beta/legal/${document}`);
}

function context(document = "privacy-notice") {
  return { params: Promise.resolve({ document }) };
}

describe("verified beta legal document route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    for (const [name, value] of Object.entries(legalEnvironment)) vi.stubEnv(name, value);
    mocks.isHostedDeployment.mockReturnValue(true);
    mocks.evaluateBetaRateLimits.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.fetchVerifiedBetaLegalDocument.mockResolvedValue({
      bytes: new TextEncoder().encode("Approved private beta privacy notice."),
      contentType: "text/plain"
    });
  });

  it("serves only freshly verified bytes in a sandboxed same-origin document", async () => {
    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("Approved private beta privacy notice.");
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-digest")).toBe(`sha-256=:${Buffer.from("b".repeat(64), "hex").toString("base64")}:`);
    expect(mocks.fetchVerifiedBetaLegalDocument).toHaveBeenCalledWith(expect.objectContaining({
      sha256: "b".repeat(64),
      title: "Private beta privacy notice",
      version: "privacy-v1"
    }));
  });

  it("rejects unknown documents without fetching an arbitrary URL", async () => {
    const response = await GET(request("anything"), context("anything"));

    expect(response.status).toBe(404);
    expect(mocks.fetchVerifiedBetaLegalDocument).not.toHaveBeenCalled();
  });

  it("fails closed without exposing validation or provider details", async () => {
    mocks.fetchVerifiedBetaLegalDocument.mockRejectedValue(new Error("https://secret.invalid provider marker"));

    const response = await GET(request(), context());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret.invalid");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("does not expose the document viewer outside hosted deployments", async () => {
    mocks.isHostedDeployment.mockReturnValue(false);

    const response = await GET(request(), context());
    expect(response.status).toBe(404);
    expect(mocks.evaluateBetaRateLimits).not.toHaveBeenCalled();
  });
});
