import { describe, expect, it } from "vitest";

import {
  currentBetaLegalAcceptance,
  isCurrentBetaLegalAcceptance,
  loadApprovedBetaLegalManifest
} from "@/lib/beta-legal-manifest";

function approvedEnvironment(): Record<string, string> {
  return {
    KINRESOLVE_BETA_LEGAL_STATUS: "approved",
    KINRESOLVE_BETA_PARTICIPATION_TERMS_VERSION: "participation-v1",
    KINRESOLVE_BETA_PARTICIPATION_TERMS_SHA256: "1".repeat(64),
    KINRESOLVE_BETA_PARTICIPATION_TERMS_URL: "https://kinresolve.com/legal/private-beta-terms",
    KINRESOLVE_BETA_PRIVACY_NOTICE_VERSION: "privacy-v1",
    KINRESOLVE_BETA_PRIVACY_NOTICE_SHA256: "2".repeat(64),
    KINRESOLVE_BETA_PRIVACY_NOTICE_URL: "https://kinresolve.com/legal/private-beta-privacy",
    KINRESOLVE_BETA_BOUNDARY_VERSION: "boundary-v1",
    KINRESOLVE_BETA_BOUNDARY_SHA256: "3".repeat(64),
    KINRESOLVE_BETA_BOUNDARY_URL: "https://kinresolve.com/legal/cohort-one-boundary"
  };
}

describe("approved beta legal manifest", () => {
  it("loads only exact approved external-document metadata", () => {
    const manifest = loadApprovedBetaLegalManifest(approvedEnvironment());
    const acceptance = currentBetaLegalAcceptance(manifest);

    expect(manifest.status).toBe("approved");
    expect(manifest.participationTerms).toEqual({
      title: "Private beta participation terms",
      version: "participation-v1",
      sha256: "1".repeat(64),
      url: "https://kinresolve.com/legal/private-beta-terms"
    });
    expect(manifest.participationTerms).not.toHaveProperty("text");
    expect(isCurrentBetaLegalAcceptance(acceptance, manifest)).toBe(true);
    expect(isCurrentBetaLegalAcceptance({ ...acceptance, privacyNoticeSha256: "4".repeat(64) }, manifest)).toBe(false);
  });

  it.each([
    ["unapproved status", { KINRESOLVE_BETA_LEGAL_STATUS: "draft" }],
    ["uppercase digest", { KINRESOLVE_BETA_PRIVACY_NOTICE_SHA256: "A".repeat(64) }],
    ["non-HTTPS URL", { KINRESOLVE_BETA_BOUNDARY_URL: "http://kinresolve.com/legal/boundary" }],
    ["URL with a query", { KINRESOLVE_BETA_BOUNDARY_URL: "https://kinresolve.com/legal/boundary?v=1" }],
    ["URL on another origin", { KINRESOLVE_BETA_BOUNDARY_URL: "https://example.com/legal/boundary" }],
    ["missing version", { KINRESOLVE_BETA_PARTICIPATION_TERMS_VERSION: "" }]
  ])("fails closed for %s", (_label, override) => {
    expect(() => loadApprovedBetaLegalManifest({ ...approvedEnvironment(), ...override })).toThrow(
      /legal metadata/i
    );
  });
});
