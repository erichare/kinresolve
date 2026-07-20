// Aggressive PII scrubbing for Sentry error events, shared by the server,
// edge, and client initializers. Kin Resolve treats error tracking as
// stack-trace telemetry only: request headers, cookies, query strings, bodies,
// and user identity never leave the deployment.
//
// The function is structural rather than typed against Sentry's Event so it
// stays dependency-free and unit-testable with synthetic events.

const scrubbedRequestFields = ["cookies", "data", "env", "headers", "query_string"] as const;

export function scrubSentryEvent<E extends object>(event: E): E {
  const scrubbed = { ...event } as Record<string, unknown>;

  // Identity is never useful for a scrubbed stack trace.
  delete scrubbed.user;
  delete scrubbed.server_name;

  if (typeof scrubbed.request === "object" && scrubbed.request !== null) {
    const request = { ...(scrubbed.request as Record<string, unknown>) };
    for (const field of scrubbedRequestFields) {
      delete request[field];
    }
    if (typeof request.url === "string") {
      request.url = stripUrlQuery(request.url);
    }
    scrubbed.request = request;
  }

  if (Array.isArray(scrubbed.breadcrumbs)) {
    // Breadcrumb payloads can echo fetch URLs and response details; keep the
    // category/message skeleton but drop attached data.
    scrubbed.breadcrumbs = scrubbed.breadcrumbs.map((breadcrumb: unknown) => {
      if (typeof breadcrumb !== "object" || breadcrumb === null) return breadcrumb;
      const next = { ...(breadcrumb as Record<string, unknown>) };
      delete next.data;
      return next;
    });
  }

  return scrubbed as E;
}

function stripUrlQuery(url: string): string {
  const separator = url.search(/[?#]/);
  return separator === -1 ? url : url.slice(0, separator);
}
