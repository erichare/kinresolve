import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  passwordResetFailureMessage,
  passwordResetRequestMessage,
  passwordResetTokenFromFragment
} from "@/lib/password-recovery";

describe("password-recovery token boundary", () => {
  it("accepts exactly one base64url token from the URL fragment", () => {
    const token = "A_valid-password-reset-token_123";

    expect(passwordResetTokenFromFragment(`#token=${token}`)).toBe(token);
  });

  it.each([
    "",
    "token=valid-token-123456",
    "#token=too-short",
    "#token=contains%20space",
    "#token=%41_valid-password-reset-token_123",
    "#token=valid-token-123456&token=second-token-123456",
    "#token=valid-token-123456&next=/app",
    "#next=/app",
    "?token=query-token-must-not-work"
  ])("rejects an ambiguous or malformed fragment: %s", (fragment) => {
    expect(passwordResetTokenFromFragment(fragment)).toBeNull();
  });

  it("uses generic public messages that do not assert account existence", () => {
    expect(passwordResetRequestMessage).toContain("If an eligible account matches");
    expect(passwordResetRequestMessage).not.toMatch(/account (exists|does not exist)/i);
    expect(passwordResetFailureMessage).not.toMatch(/account (exists|does not exist)/i);
  });
});

describe("password-recovery browser contract", () => {
  const resetSource = readFileSync(path.join(process.cwd(), "components/reset-password-form.tsx"), "utf8");
  const forgotSource = readFileSync(path.join(process.cwd(), "components/forgot-password-form.tsx"), "utf8");
  const resetPageSource = readFileSync(path.join(process.cwd(), "app/reset-password/page.tsx"), "utf8");

  it("reads the reset token only from the fragment and immediately replaces the history entry", () => {
    expect(resetSource).toContain("passwordResetTokenFromFragment(window.location.hash)");
    expect(resetSource).toContain('window.history.replaceState(window.history.state, "", window.location.pathname)');
    expect(resetSource).not.toContain("window.location.search");
    expect(resetSource).not.toMatch(/console\.(?:log|info|warn|error)/);
    expect(resetPageSource).not.toContain("searchParams");
  });

  it("submits the token in the reset body and never interpolates it into a URL", () => {
    expect(resetSource).toContain("authClient.resetPassword");
    expect(resetSource).toMatch(/newPassword: password,\s*token/s);
    expect(resetSource).not.toMatch(/(?:href|assign|replace|push)\s*\([^)]*token/);
  });

  it("retains the in-memory reset token and exposes retry UI for temporary failures", () => {
    expect(resetSource).toContain("isRetryableBrowserActionStatus(result.error.status)");
    expect(resetSource).toContain('setStatus("retryable")');
    expect(resetSource).toContain("Try resetting again");
    expect(resetSource).toContain("The link is still available in this tab");
  });

  it("returns the same recovery-request completion state for errors and successes", () => {
    expect(forgotSource).toContain("authClient.requestPasswordReset");
    expect(forgotSource.match(/setStatus\("complete"\)/g)).toHaveLength(1);
    expect(forgotSource).not.toMatch(/result\.error|error\.message|console\./);
  });
});
