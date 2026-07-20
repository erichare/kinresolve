import * as Sentry from "@sentry/nextjs";

import { scrubSentryEvent } from "./lib/sentry-scrub";

// Browser-side Sentry mirrors the server posture: opt-in via the build-time
// DSN, scrubbed error events only, no tracing, and no session replay. The
// replay integration is never registered, so no recording code loads.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: () => null,
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
