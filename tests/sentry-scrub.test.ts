import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { scrubSentryEvent } from "@/lib/sentry-scrub";

describe("Sentry beforeSend scrubber", () => {
  const syntheticEvent = {
    breadcrumbs: [
      {
        category: "fetch",
        data: { method: "POST", url: "https://app.kinresolve.com/api/people?name=Nora" },
        message: "fetch"
      }
    ],
    event_id: "8f1f4d3c1a0b4b6c9e2d5a7b8c9d0e1f",
    exception: {
      values: [{ type: "TypeError", value: "Cannot read properties of undefined" }]
    },
    request: {
      cookies: { kinsleuth_session: "secret-cookie" },
      data: "email=pilot%40example.com",
      env: { REMOTE_ADDR: "203.0.113.7" },
      headers: { authorization: "Bearer kr_beta_secret", cookie: "kinsleuth_session=secret" },
      method: "POST",
      query_string: "invite=abc123",
      url: "https://app.kinresolve.com/beta/accept?invite=abc123#fragment"
    },
    server_name: "family-cell-host",
    user: { email: "pilot@example.com", id: "user-1", ip_address: "203.0.113.7" }
  };

  it("strips headers, cookies, query, body, env, and user from a synthetic event", () => {
    const scrubbed = scrubSentryEvent(syntheticEvent) as Record<string, unknown>;
    const request = scrubbed.request as Record<string, unknown>;

    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.server_name).toBeUndefined();
    expect(request.headers).toBeUndefined();
    expect(request.cookies).toBeUndefined();
    expect(request.data).toBeUndefined();
    expect(request.env).toBeUndefined();
    expect(request.query_string).toBeUndefined();
    expect(request.url).toBe("https://app.kinresolve.com/beta/accept");
    expect(request.method).toBe("POST");

    const breadcrumbs = scrubbed.breadcrumbs as Array<Record<string, unknown>>;
    expect(breadcrumbs[0].data).toBeUndefined();
    expect(breadcrumbs[0].category).toBe("fetch");

    // Nothing secret survives anywhere in the scrubbed payload.
    const serialized = JSON.stringify(scrubbed);
    for (const secret of [
      "secret-cookie",
      "kr_beta_secret",
      "pilot@example.com",
      "pilot%40example.com",
      "invite=abc123",
      "203.0.113.7",
      "family-cell-host",
      "name=Nora"
    ]) {
      expect(serialized).not.toContain(secret);
    }

    // The stack-trace signal itself is preserved.
    expect(serialized).toContain("TypeError");
    expect((scrubbed.event_id as string).length).toBe(32);
  });

  it("returns a new event object instead of mutating the original", () => {
    const original = structuredClone(syntheticEvent);
    const scrubbed = scrubSentryEvent(syntheticEvent);
    expect(scrubbed).not.toBe(syntheticEvent);
    expect(syntheticEvent).toEqual(original);
  });

  it("passes through events without request, breadcrumbs, or user untouched in shape", () => {
    const minimal = { exception: { values: [{ type: "Error" }] } };
    expect(scrubSentryEvent(minimal)).toEqual(minimal);
  });

  it("keeps the hosted Sentry posture pinned: scrubbed, traceless, replayless, opt-in", async () => {
    const [server, client, config] = await Promise.all([
      readFile("instrumentation.ts", "utf8"),
      readFile("instrumentation-client.ts", "utf8"),
      readFile("next.config.ts", "utf8")
    ]);

    for (const initializer of [server, client]) {
      expect(initializer).toContain("sendDefaultPii: false");
      expect(initializer).toContain("tracesSampleRate: 0");
      expect(initializer).toContain("scrubSentryEvent(event)");
      expect(initializer).toContain("beforeSendTransaction: () => null");
      expect(initializer).not.toMatch(/replayIntegration|Replay/);
      expect(initializer).toContain("NEXT_PUBLIC_SENTRY_DSN");
    }

    // Source-map upload is conditional on the workflow-only SENTRY_* build
    // credentials, keeps standalone output, and deletes uploaded maps.
    expect(config).toContain('output: "standalone"');
    expect(config).toContain("sentrySourceMapUploadConfigured()");
    expect(config).toContain("process.env.SENTRY_AUTH_TOKEN?.trim()");
    expect(config).toContain("process.env.SENTRY_ORG?.trim()");
    expect(config).toContain("process.env.SENTRY_PROJECT?.trim()");
    expect(config).toContain("withSentryConfig(nextConfig, {");
    expect(config).toContain("sourcemaps: { deleteSourcemapsAfterUpload: true }");
    expect(config).toContain("telemetry: false");
    expect(config).toContain(": nextConfig;");
  });
});
