import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  requestBetaVerificationReissue,
  verificationReissueGenericMessage,
  type VerificationReissueFetch
} from "@/lib/verification-reissue-browser";

describe("verification reissue browser boundary", () => {
  it("posts only the email with no-store and returns the fixed generic copy", async () => {
    const providerResponse = new Response(JSON.stringify({ accountExists: true }), {
      status: 202,
      headers: { "content-type": "application/json" }
    });
    const text = vi.spyOn(providerResponse, "text");
    const json = vi.spyOn(providerResponse, "json");
    const fetchImplementation = vi.fn<VerificationReissueFetch>(async () => providerResponse);

    const result = await requestBetaVerificationReissue(
      "researcher@example.com",
      fetchImplementation
    );

    expect(result).toBe(verificationReissueGenericMessage);
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(fetchImplementation).toHaveBeenCalledWith(
      "/api/beta/email-verification/reissue",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        credentials: "omit",
        body: JSON.stringify({ email: "researcher@example.com" })
      }
    );
    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it.each([400, 404, 409, 429, 500, 503])(
    "returns the identical generic copy for HTTP %s",
    async (status) => {
      const response = new Response("provider-account-detail-must-not-be-read", { status });
      const text = vi.spyOn(response, "text");

      await expect(requestBetaVerificationReissue(
        "researcher@example.com",
        async () => response
      )).resolves.toBe(verificationReissueGenericMessage);
      expect(text).not.toHaveBeenCalled();
    }
  );

  it("returns the same copy for exceptions without logging email or provider details", async () => {
    const leak = "researcher@example.com provider-account-secret";
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(requestBetaVerificationReissue(
      "researcher@example.com",
      async () => { throw new Error(leak); }
    )).resolves.toBe(verificationReissueGenericMessage);

    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("verification reissue source contract", () => {
  const form = source("components/resend-verification-form.tsx");
  const page = source("app/resend-verification/page.tsx");
  const login = source("app/login/page.tsx");
  const verification = source("components/beta-email-verification.tsx");

  it("keeps the public page out of search and accepts one accessible email field", () => {
    expect(page).toMatch(/robots:\s*\{ index: false, follow: false \}/);
    expect(page).not.toContain("searchParams");
    expect(form).toContain("verificationReissueGenericMessage");
    expect(form).toMatch(/autoComplete="email"[\s\S]*required[\s\S]*type="email"/);
    expect(form).toContain('aria-live="polite"');
    expect(form).not.toMatch(/console\.(?:log|info|warn|error)/);
  });

  it("links the hosted login and invalid verification state to the reissue page", () => {
    expect(login).toContain('href="/resend-verification"');
    expect(verification).toContain('href="/resend-verification"');
    expect(verification).toMatch(/invalid[\s\S]*Request a new verification email/i);
  });
});

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}
