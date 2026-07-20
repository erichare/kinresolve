import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const buildReleaseCommitSha = validatedBuildReleaseCommitSha();

const nextConfig: NextConfig = {
  ...(buildReleaseCommitSha
    ? { env: { KINRESOLVE_BUILD_COMMIT_SHA: buildReleaseCommitSha } }
    : {}),
  poweredByHeader: false,
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./certs/supabase-prod-ca-2021.crt", "./db/migrations/*.sql"]
  },
  typedRoutes: false,
  experimental: {
    proxyClientMaxBodySize: "64mb"
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders()
      }
    ];
  }
};

function validatedBuildReleaseCommitSha(): string | undefined {
  const value = process.env.KINRESOLVE_BUILD_COMMIT_SHA?.trim().toLowerCase();
  return value && /^[a-f0-9]{40}$/.test(value) ? value : undefined;
}

function securityHeaders(): Array<{ key: string; value: string }> {
  const development = process.env.NODE_ENV !== "production";
  // Cookieless Plausible analytics are allowed only for hosted builds whose
  // analytics mode is explicitly plausible; self-hosted builds keep the
  // strict Content Security Policy.
  const plausibleAnalytics = plausibleAnalyticsBuild() && hostedBuild();
  // The demo Turnstile challenge loads only for hosted builds whose demo
  // Turnstile mode is shadow or required; every other build keeps the strict
  // policy with no Cloudflare origins at all.
  const demoTurnstile = demoTurnstileBuild() && hostedBuild();
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    ...(development ? ["'unsafe-eval'"] : []),
    ...(plausibleAnalytics ? ["https://plausible.io"] : []),
    ...(demoTurnstile ? ["https://challenges.cloudflare.com"] : [])
  ];
  const connectSources = [
    "'self'",
    "https://vercel.com",
    "https://*.blob.vercel-storage.com",
    ...(development ? ["ws:"] : []),
    ...(plausibleAnalytics ? ["https://plausible.io"] : [])
  ];
  const storageOrigin = configuredStorageOrigin();
  if (storageOrigin) {
    connectSources.push(storageOrigin);
  }
  // Sentry error events go only to the exact ingest origin the configured DSN
  // names; without a DSN, no Sentry origin enters the policy at all.
  const sentryOrigin = sentryIngestOrigin();
  if (sentryOrigin) {
    connectSources.push(sentryOrigin);
  }

  const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    ...(demoTurnstile ? ["frame-src 'self' https://challenges.cloudflare.com"] : []),
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy },
    ...(development || !hostedBuild()
      ? []
      : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "no-referrer" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()"
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    ...(privateHostedBuild()
      ? [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }]
      : [])
  ];
}

function sentryIngestOrigin(): string | undefined {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) return undefined;
  try {
    const url = new URL(dsn);
    return url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function configuredStorageOrigin(): string | undefined {
  const endpoint = process.env.S3_PUBLIC_ENDPOINT?.trim() || process.env.S3_ENDPOINT?.trim();
  if (!endpoint) return undefined;
  try {
    const url = new URL(endpoint);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function privateHostedBuild(): boolean {
  return hostedBuild() && process.env.KINRESOLVE_PUBLIC_ARCHIVE_ENABLED?.trim().toLowerCase() !== "true";
}

function demoTurnstileBuild(): boolean {
  const mode = process.env.KINRESOLVE_DEMO_TURNSTILE_MODE;
  if (mode === undefined || mode === "off") return false;
  if (mode === "shadow" || mode === "required") return true;
  throw new Error("KINRESOLVE_DEMO_TURNSTILE_MODE must be exactly off, shadow, or required.");
}

function plausibleAnalyticsBuild(): boolean {
  const mode = process.env.KINRESOLVE_PUBLIC_DEMO_ANALYTICS;
  if (mode === undefined || mode === "off") return false;
  if (mode === "plausible") return true;
  throw new Error("KINRESOLVE_PUBLIC_DEMO_ANALYTICS must be exactly off or plausible.");
}

function hostedBuild(): boolean {
  const deploymentMode = process.env.KINRESOLVE_DEPLOYMENT_MODE?.trim().toLowerCase();
  if (deploymentMode === "hosted") return true;
  if (deploymentMode === "self-hosted") return false;
  return process.env.VERCEL_ENV?.trim().toLowerCase() === "production"
    || (process.env.VERCEL?.trim() === "1" && process.env.NODE_ENV === "production");
}

// Source-map upload is workflow-only: the release workflows provide the
// SENTRY_* build credentials, and every other build — self-hosted, local, and
// CI — exports the identical untouched configuration with `output:
// "standalone"` preserved. Uploaded source maps are deleted from the build
// output so deployments never serve them.
function sentrySourceMapUploadConfigured(): boolean {
  return Boolean(
    process.env.SENTRY_AUTH_TOKEN?.trim()
    && process.env.SENTRY_ORG?.trim()
    && process.env.SENTRY_PROJECT?.trim()
  );
}

export default sentrySourceMapUploadConfigured()
  ? withSentryConfig(nextConfig, {
    authToken: process.env.SENTRY_AUTH_TOKEN,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    silent: true,
    sourcemaps: { deleteSourcemapsAfterUpload: true },
    // Error tracking is best effort: a failed source-map upload must never
    // fail a release build.
    errorHandler: (error) => {
      console.warn(`Sentry source-map upload failed: ${error.message}`);
    },
    telemetry: false,
    widenClientFileUpload: false
  })
  : nextConfig;
