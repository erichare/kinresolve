import * as Sentry from "@sentry/nextjs";

import { scrubSentryEvent } from "./lib/sentry-scrub";

// Sentry error tracking is opt-in per deployment: without a configured DSN
// (self-hosted builds, local development, tests) nothing initializes and no
// telemetry code path runs. When enabled, events carry scrubbed stack traces
// only — no headers, cookies, query strings, bodies, or user identity — and
// tracing and session replay stay disabled.
export function register(): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) return;
  Sentry.init({
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: () => null,
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0
  });
}

// Uninitialized Sentry makes this a no-op, so DSN-less builds are unaffected.
export const onRequestError = Sentry.captureRequestError;
