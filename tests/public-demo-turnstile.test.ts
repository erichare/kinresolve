import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import {
  admitPublicDemoTurnstile,
  parsePublicDemoTurnstileMode,
  publicDemoTurnstileAction,
  publicDemoTurnstileHostname,
  resolvePublicDemoTurnstileConfiguration,
  type PublicDemoTurnstileConfiguration
} from "@/lib/public-demo-turnstile";
import type { TurnstileVerdict } from "@/lib/turnstile-verify";

const enabledEnvironment = {
  KINRESOLVE_DEMO_TURNSTILE_MODE: "shadow",
  KINRESOLVE_TURNSTILE_SECRET_KEY: "s".repeat(35),
  NEXT_PUBLIC_KINRESOLVE_DEMO_TURNSTILE_SITE_KEY: "0x4AAAAAAADemoSiteKey"
};

function dependencies(verdict?: TurnstileVerdict) {
  return {
    captureError: vi.fn(async () => ({}) as never),
    verify: vi.fn(async () => verdict ?? ({ outcome: "verified" } as const))
  };
}

function configuration(mode: "shadow" | "required"): PublicDemoTurnstileConfiguration {
  return { mode, secretKey: "s".repeat(35), siteKey: "0x4AAAAAAADemoSiteKey" };
}

describe("public demo Turnstile configuration", () => {
  it("defaults to off and accepts only the three ladder rungs", () => {
    expect(parsePublicDemoTurnstileMode(undefined)).toBe("off");
    expect(parsePublicDemoTurnstileMode("off")).toBe("off");
    expect(parsePublicDemoTurnstileMode("shadow")).toBe("shadow");
    expect(parsePublicDemoTurnstileMode("required")).toBe("required");
    for (const invalid of ["", "on", "Shadow", "required "]) {
      expect(() => parsePublicDemoTurnstileMode(invalid))
        .toThrow(/must be exactly off, shadow, or required/);
    }
  });

  it("fails closed when an enabled rung is missing its site key or secret", () => {
    expect(resolvePublicDemoTurnstileConfiguration({})).toEqual({ mode: "off" });
    expect(resolvePublicDemoTurnstileConfiguration(enabledEnvironment)).toEqual({
      mode: "shadow",
      secretKey: "s".repeat(35),
      siteKey: "0x4AAAAAAADemoSiteKey"
    });
    expect(() => resolvePublicDemoTurnstileConfiguration({
      ...enabledEnvironment,
      NEXT_PUBLIC_KINRESOLVE_DEMO_TURNSTILE_SITE_KEY: undefined
    })).toThrow(/NEXT_PUBLIC_KINRESOLVE_DEMO_TURNSTILE_SITE_KEY must be a plain widget site key/);
    expect(() => resolvePublicDemoTurnstileConfiguration({
      ...enabledEnvironment,
      KINRESOLVE_TURNSTILE_SECRET_KEY: undefined
    })).toThrow(/KINRESOLVE_TURNSTILE_SECRET_KEY is required/);
  });
});

describe("public demo Turnstile admission ladder", () => {
  it("admits everything in off mode and every authorized canary without verifying", async () => {
    const offDependencies = dependencies();
    await expect(admitPublicDemoTurnstile({
      configuration: { mode: "off" },
      isCanary: false,
      token: undefined
    }, offDependencies)).resolves.toEqual({ outcome: "admitted" });

    const canaryDependencies = dependencies({ outcome: "rejected" });
    await expect(admitPublicDemoTurnstile({
      configuration: configuration("required"),
      isCanary: true,
      token: undefined
    }, canaryDependencies)).resolves.toEqual({ outcome: "admitted" });
    expect(offDependencies.verify).not.toHaveBeenCalled();
    expect(canaryDependencies.verify).not.toHaveBeenCalled();
  });

  it("shadow mode verifies and logs but never changes the admission decision", async () => {
    const absent = dependencies();
    await expect(admitPublicDemoTurnstile({
      configuration: configuration("shadow"),
      isCanary: false,
      token: undefined
    }, absent)).resolves.toEqual({ outcome: "admitted" });
    expect(absent.verify).not.toHaveBeenCalled();
    expect(absent.captureError).toHaveBeenCalledOnce();

    const rejected = dependencies({ outcome: "rejected" });
    await expect(admitPublicDemoTurnstile({
      configuration: configuration("shadow"),
      isCanary: false,
      token: "bad-token"
    }, rejected)).resolves.toEqual({ outcome: "admitted" });
    expect(rejected.verify).toHaveBeenCalledWith({
      expectedAction: publicDemoTurnstileAction,
      expectedHostname: publicDemoTurnstileHostname,
      secretKey: "s".repeat(35),
      token: "bad-token"
    });
    expect(rejected.captureError).toHaveBeenCalledOnce();
  });

  it("required mode rejects absent and definitively failed tokens", async () => {
    const absent = dependencies();
    await expect(admitPublicDemoTurnstile({
      configuration: configuration("required"),
      isCanary: false,
      token: undefined
    }, absent)).resolves.toEqual({ outcome: "rejected" });
    expect(absent.verify).not.toHaveBeenCalled();

    const rejected = dependencies({ outcome: "rejected" });
    await expect(admitPublicDemoTurnstile({
      configuration: configuration("required"),
      isCanary: false,
      token: "replayed-token"
    }, rejected)).resolves.toEqual({ outcome: "rejected" });

    const verified = dependencies({ outcome: "verified" });
    await expect(admitPublicDemoTurnstile({
      configuration: configuration("required"),
      isCanary: false,
      token: "good-token"
    }, verified)).resolves.toEqual({ outcome: "admitted" });
    expect(verified.captureError).not.toHaveBeenCalled();
  });

  it("keeps a siteverify outage from blocking visitors while capturing it operationally", async () => {
    const outage = new Error("siteverify unavailable");
    for (const mode of ["shadow", "required"] as const) {
      const probe = dependencies({ error: outage, outcome: "unavailable" });
      await expect(admitPublicDemoTurnstile({
        configuration: configuration(mode),
        isCanary: false,
        token: "unverifiable-token"
      }, probe)).resolves.toEqual({ outcome: "admitted" });
      expect(probe.captureError).toHaveBeenCalledWith({
        event: "api_error",
        route: "/api/demo/sessions",
        severity: "warning",
        statusClass: "2xx"
      }, outage);
    }
  });

  it("never lets a telemetry failure change the admission outcome", async () => {
    const probe = dependencies({ outcome: "rejected" });
    probe.captureError.mockRejectedValueOnce(new Error("tracker offline"));
    await expect(admitPublicDemoTurnstile({
      configuration: configuration("shadow"),
      isCanary: false,
      token: "bad-token"
    }, probe)).resolves.toEqual({ outcome: "admitted" });
  });
});

describe("public demo session-start Turnstile wiring", () => {
  it("pins the route ladder: canary bypass, optional token, and the 403 fallback shape", async () => {
    const route = await readFile("app/api/demo/sessions/route.ts", "utf8");

    expect(route).toContain("turnstileToken: z.string().min(1).max(2_048).optional()");
    expect(route).toContain("admitPublicDemoTurnstile");
    expect(route).toContain("resolvePublicDemoTurnstileConfiguration()");
    expect(route).toContain("isCanary,");
    // The rejected shape mirrors the capacity fallback: stateless family and
    // challenge alternatives, never a session cookie.
    expect(route).toMatch(/status: 403[\s\S]{0,120}"cache-control": "private, no-store"/);
    expect(route).toMatch(/turnstile\.outcome === "rejected"[\s\S]{0,400}familyUrl: "\/family"[\s\S]{0,80}challengeUrl: "\/challenge"/);
    // Turnstile admission is decided before any database reservation work.
    expect(route.indexOf("admitPublicDemoTurnstile")).toBeLessThan(
      route.indexOf("startPublicDemoSession({")
    );
  });

  it("verifies the canary and load exercises authenticate with the canary secret for the bypass", async () => {
    const [loadTest, browserCanary, spikeTest] = await Promise.all([
      readFile("scripts/public-demo-load-test.mjs", "utf8"),
      readFile("scripts/public-demo-browser-canary.mjs", "utf8"),
      readFile("scripts/public-demo-spike-test.mjs", "utf8")
    ]);
    for (const script of [loadTest, browserCanary, spikeTest]) {
      expect(script).toContain('"x-kinresolve-demo-canary": configuration.canarySecret');
      expect(script).toContain("KINRESOLVE_DEMO_CANARY_SECRET");
    }
  });

  it("renders the explicit start-form widget with token submission and widget-failure fallbacks", async () => {
    const [form, landing] = await Promise.all([
      readFile("components/demo-start-form.tsx", "utf8"),
      readFile("app/page.tsx", "utf8")
    ]);

    expect(form).toContain("challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
    expect(form).toContain("api.render(container, {");
    expect(form).toContain('action: "demo-session"');
    expect(form).toMatch(/turnstileToken \? \{ turnstileToken \} : \{\}/);
    expect(form).toContain('"error-callback"');
    expect(form).toContain('"expired-callback"');
    expect(form).toMatch(/widgetFailed && turnstileMode === "required"/);
    expect(form).toMatch(/Fallback fictional demo options/);

    expect(landing).toContain("resolvePublicDemoTurnstileConfiguration()");
    expect(landing).toMatch(/turnstileMode=\{turnstile\.mode\}/);
    expect(landing).toMatch(/turnstileSiteKey=\{turnstile\.mode === "off" \? undefined : turnstile\.siteKey\}/);
  });
});
