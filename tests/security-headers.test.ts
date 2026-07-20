import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfig from "@/next.config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("legacy product route redirect", () => {
  it("permanently redirects /kinsleuth to /kinresolve as the first configured redirect", async () => {
    const redirects = await nextConfig.redirects?.();
    expect(redirects?.[0]).toEqual({
      source: "/kinsleuth/:path*",
      destination: "/kinresolve/:path*",
      permanent: true
    });
  });
});

describe("application security headers", () => {
  it("sets the production browser perimeter and private crawler header", async () => {
    stubPrivateHostedEnvironment();
    vi.stubEnv("NODE_ENV", "production");

    expect(nextConfig.poweredByHeader).toBe(false);
    const rules = await nextConfig.headers?.();
    const headers = Object.fromEntries((rules?.[0]?.headers ?? []).map(({ key, value }) => [key, value]));

    expect(rules?.[0]?.source).toBe("/(.*)");
    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(headers["Content-Security-Policy"]).toContain("script-src 'self' 'unsafe-inline'");
    expect(headers["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
    expect(headers["Content-Security-Policy"]).toContain("connect-src 'self'");
    expect(headers["Content-Security-Policy"]).toContain("https://*.blob.vercel-storage.com");
    expect(headers["Content-Security-Policy"]).not.toContain("plausible.io");
    expect(headers["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Cross-Origin-Resource-Policy"]).toBe("same-origin");
    expect(headers["X-Robots-Tag"]).toBe("noindex, nofollow, noarchive");
  });

  it("does not impose hosted transport or crawler policy on self-hosted builds", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "self-hosted");
    vi.stubEnv("S3_PUBLIC_ENDPOINT", "https://storage.family.example:9443/uploads");
    vi.stubEnv("KINRESOLVE_PUBLIC_DEMO_ANALYTICS", "plausible");

    const rules = await nextConfig.headers?.();
    const headers = Object.fromEntries((rules?.[0]?.headers ?? []).map(({ key, value }) => [key, value]));

    expect(headers["Strict-Transport-Security"]).toBeUndefined();
    expect(headers["X-Robots-Tag"]).toBeUndefined();
    expect(headers["Content-Security-Policy"]).toContain("https://storage.family.example:9443");
    expect(headers["Content-Security-Policy"]).not.toContain("plausible.io");
  });

  it("allows only plausible.io script and event submission when hosted analytics are plausible", async () => {
    stubPrivateHostedEnvironment();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KINRESOLVE_PUBLIC_DEMO_ANALYTICS", "plausible");

    const rules = await nextConfig.headers?.();
    const headers = Object.fromEntries((rules?.[0]?.headers ?? []).map(({ key, value }) => [key, value]));

    expect(headers["Content-Security-Policy"]).toContain(
      "script-src 'self' 'unsafe-inline' https://plausible.io"
    );
    expect(headers["Content-Security-Policy"]).toMatch(
      /connect-src 'self' [^;]*https:\/\/plausible\.io/
    );
  });

  it("allows only the exact DSN-derived Sentry ingest origin, and only when a DSN is configured", async () => {
    stubPrivateHostedEnvironment();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "NEXT_PUBLIC_SENTRY_DSN",
      "https://abc123def456@o4507000000000000.ingest.us.sentry.io/4507000000000001"
    );

    const rules = await nextConfig.headers?.();
    const headers = Object.fromEntries((rules?.[0]?.headers ?? []).map(({ key, value }) => [key, value]));
    expect(headers["Content-Security-Policy"]).toMatch(
      /connect-src 'self' [^;]*https:\/\/o4507000000000000\.ingest\.us\.sentry\.io/
    );
    // Only the origin enters the policy — never the DSN key or project path.
    expect(headers["Content-Security-Policy"]).not.toContain("abc123def456");
    expect(headers["Content-Security-Policy"]).not.toContain("4507000000000001");
  });

  it("adds no Sentry origin without a DSN and ignores a malformed or non-https DSN", async () => {
    stubPrivateHostedEnvironment();
    vi.stubEnv("NODE_ENV", "production");

    const withoutDsn = await nextConfig.headers?.();
    expect(withoutDsn?.[0]?.headers.find(({ key }) => key === "Content-Security-Policy")?.value)
      .not.toContain("sentry.io");

    for (const malformed of ["not-a-url", "http://abc@o1.ingest.sentry.io/2"]) {
      vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", malformed);
      const rules = await nextConfig.headers?.();
      expect(rules?.[0]?.headers.find(({ key }) => key === "Content-Security-Policy")?.value)
        .not.toContain("sentry.io");
    }
  });

  it("rejects an invalid hosted analytics mode instead of guessing a policy", async () => {
    stubPrivateHostedEnvironment();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("KINRESOLVE_PUBLIC_DEMO_ANALYTICS", "on");

    await expect(nextConfig.headers?.()).rejects.toThrow(
      /KINRESOLVE_PUBLIC_DEMO_ANALYTICS must be exactly off or plausible\./
    );
  });

  it("admits the Turnstile challenge origins only for hosted builds with an enabled demo mode", async () => {
    stubPrivateHostedEnvironment();
    vi.stubEnv("NODE_ENV", "production");

    const withoutTurnstile = await nextConfig.headers?.();
    const strictCsp = withoutTurnstile?.[0]?.headers
      .find(({ key }) => key === "Content-Security-Policy")?.value ?? "";
    expect(strictCsp).not.toContain("challenges.cloudflare.com");
    expect(strictCsp).not.toContain("frame-src");

    for (const mode of ["shadow", "required"]) {
      vi.stubEnv("KINRESOLVE_DEMO_TURNSTILE_MODE", mode);
      const rules = await nextConfig.headers?.();
      const csp = rules?.[0]?.headers.find(({ key }) => key === "Content-Security-Policy")?.value ?? "";
      expect(csp).toMatch(/script-src [^;]*https:\/\/challenges\.cloudflare\.com/);
      expect(csp).toContain("frame-src 'self' https://challenges.cloudflare.com");
    }

    vi.stubEnv("KINRESOLVE_DEMO_TURNSTILE_MODE", "on");
    await expect(nextConfig.headers?.()).rejects.toThrow(
      /KINRESOLVE_DEMO_TURNSTILE_MODE must be exactly off, shadow, or required\./
    );

    vi.stubEnv("KINRESOLVE_DEMO_TURNSTILE_MODE", "required");
    vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "self-hosted");
    const selfHosted = await nextConfig.headers?.();
    expect(selfHosted?.[0]?.headers.find(({ key }) => key === "Content-Security-Policy")?.value)
      .not.toContain("challenges.cloudflare.com");
  });
});

function stubPrivateHostedEnvironment(): void {
  vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "hosted");
  vi.stubEnv("KINRESOLVE_DATASET_MODE", "pilot");
  vi.stubEnv("KINRESOLVE_DNA_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_EXTERNAL_AI_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_PUBLIC_ARCHIVE_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_PUBLIC_PUBLISHING_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_PACKAGE_MEDIA_ENABLED", "false");
  vi.stubEnv("KINRESOLVE_PLAIN_GEDCOM_ENABLED", "true");
}
