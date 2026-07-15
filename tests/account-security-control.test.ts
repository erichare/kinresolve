import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountSecurityControl } from "@/components/account-security-control";

describe("account security control", () => {
  const controlSource = readFileSync(
    path.join(process.cwd(), "components/account-security-control.tsx"),
    "utf8"
  );
  const settingsSource = readFileSync(path.join(process.cwd(), "app/app/settings/page.tsx"), "utf8");

  it("starts with a deliberate first-step control without exposing session details", () => {
    const html = renderToStaticMarkup(createElement(AccountSecurityControl));

    expect(html).toMatch(/Account security/i);
    expect(html).toMatch(/Sign out all sessions/i);
    expect(html).not.toMatch(/Confirm and sign out everywhere/i);
    expect(html).not.toMatch(/session token|user agent|ip address/i);
  });

  it("uses the audited server-side revoke-all operation and never lists or reads bearer session tokens", () => {
    expect(controlSource).toContain('fetch("/api/auth/security/revoke-sessions"');
    expect(controlSource).not.toMatch(/authClient\.listSessions|authClient\.revokeSession\(/);
    expect(controlSource).not.toMatch(/\.token\b|session\.token|console\./);
  });

  it("requires a confirmation state and redirects only after a successful result", () => {
    expect(controlSource).toContain('setStatus("confirming")');
    expect(controlSource).toContain("Confirm and sign out everywhere");
    expect(controlSource).toContain('window.location.assign("/login?reason=sessions-revoked")');
    expect(controlSource.indexOf("if (!response.ok)")).toBeLessThan(
      controlSource.indexOf('window.location.assign("/login?reason=sessions-revoked")')
    );
  });

  it("surfaces only a generic safe failure and is mounted on Settings", () => {
    expect(controlSource).toContain("We could not confirm that every session was signed out.");
    expect(controlSource).not.toMatch(/error\.message|String\(error\)|JSON\.stringify\(error\)/);
    expect(settingsSource).toContain("<AccountSecurityControl />");
  });
});
