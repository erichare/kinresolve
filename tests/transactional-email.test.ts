import { describe, expect, it, vi } from "vitest";

import {
  ResendTransactionalEmailTransport,
  TransactionalEmailDeliveryError,
  buildInviteActionUrl,
  buildPasswordResetActionUrl,
  buildVerificationActionUrl,
  createTransactionalEmailIdempotencyKey,
  parseTransactionalEmailConfig,
  type FetchLike,
  type ResendTransactionalEmailTransportOptions,
  type TransactionalEmailMessage
} from "@/lib/transactional-email";
import {
  renderInviteEmail,
  renderPasswordChangedEmail,
  renderPasswordResetEmail,
  renderSecurityNotificationEmail,
  renderVerificationEmail
} from "@/lib/transactional-email-templates";

const baseEnvironment = {
  APP_BASE_URL: "https://app.kinresolve.com",
  KINRESOLVE_TRANSACTIONAL_EMAIL_PROVIDER: "resend",
  KINRESOLVE_TRANSACTIONAL_EMAIL_FROM: "Kin Resolve <beta@kinresolve.com>",
  KINRESOLVE_TRANSACTIONAL_EMAIL_REPLY_TO: "beta@kinresolve.com",
  RESEND_API_KEY: "re_test_1234567890abcdefghijkl"
};

function configuredTransport(
  fetchImplementation: FetchLike,
  options: ResendTransactionalEmailTransportOptions = {}
) {
  return new ResendTransactionalEmailTransport(
    parseTransactionalEmailConfig(baseEnvironment),
    fetchImplementation,
    options
  );
}

function exampleMessage(): TransactionalEmailMessage {
  return {
    kind: "invite",
    to: "researcher@example.com",
    idempotencyKey: createTransactionalEmailIdempotencyKey(
      "invite",
      "invitation-018f7e4e-713a-7b75-8b2e-0282d1307839"
    ),
    subject: "Your Kin Resolve invitation",
    text: "A plain-text message.",
    html: "<p>An HTML message.</p>"
  };
}

describe("transactional email configuration", () => {
  it("parses one explicit Resend configuration and canonical app origin", () => {
    expect(parseTransactionalEmailConfig(baseEnvironment)).toEqual({
      provider: "resend",
      appBaseUrl: "https://app.kinresolve.com",
      apiKey: baseEnvironment.RESEND_API_KEY,
      from: "Kin Resolve <beta@kinresolve.com>",
      replyTo: "beta@kinresolve.com"
    });
  });

  it.each([
    ["provider", { KINRESOLVE_TRANSACTIONAL_EMAIL_PROVIDER: "Resend" }],
    ["API key", { RESEND_API_KEY: " re_secret_with_whitespace" }],
    ["HTTPS origin", { APP_BASE_URL: "http://app.kinresolve.com" }],
    ["canonical HTTPS origin", { APP_BASE_URL: "https://app.kinresolve.com/auth" }],
    ["sender", { KINRESOLVE_TRANSACTIONAL_EMAIL_FROM: "Kin Resolve <beta@kinresolve.com>\r\nBcc: leak@example.com" }],
    ["reply-to", { KINRESOLVE_TRANSACTIONAL_EMAIL_REPLY_TO: "" }]
  ])("rejects an invalid %s without reflecting the supplied value", (label, replacement) => {
    const environment = { ...baseEnvironment, ...replacement };

    expect(() => parseTransactionalEmailConfig(environment)).toThrow();
    try {
      parseTransactionalEmailConfig(environment);
    } catch (error) {
      const suppliedValue = Object.values(replacement)[0];
      if (suppliedValue !== "") expect(String(error)).not.toContain(suppliedValue);
      expect(String(error)).toMatch(new RegExp(label, "i"));
    }
  });
});

describe("transactional action links", () => {
  const inviteToken = "invite_1234567890abcdefghijklmnop";
  const verificationToken = "verify_1234567890abcdefghijklmnop";
  const resetToken = "reset_1234567890abcdefghijklmnop";

  it("builds exact canonical links with capability tokens only in fragments", () => {
    const links = [
      [buildInviteActionUrl(baseEnvironment.APP_BASE_URL, inviteToken), `/invite#token=${inviteToken}`],
      [buildVerificationActionUrl(baseEnvironment.APP_BASE_URL, verificationToken), `/verify-email#token=${verificationToken}`],
      [buildPasswordResetActionUrl(baseEnvironment.APP_BASE_URL, resetToken), `/reset-password#token=${resetToken}`]
    ] as const;

    for (const [link, suffix] of links) {
      expect(link).toBe(`${baseEnvironment.APP_BASE_URL}${suffix}`);
      expect(new URL(link).search).toBe("");
      expect(link.slice(0, link.indexOf("#"))).not.toMatch(/invite_|verify_|reset_/);
    }
  });

  it("rejects non-canonical origins and malformed capability tokens", () => {
    expect(() => buildInviteActionUrl("https://app.kinresolve.com/base", inviteToken)).toThrow(/origin/i);
    expect(() => buildInviteActionUrl(baseEnvironment.APP_BASE_URL, "short token")).toThrow(/token/i);
  });
});

describe("transactional email templates", () => {
  const expiresAt = new Date("2026-07-16T18:30:00.000Z");
  const occurredAt = new Date("2026-07-15T17:00:00.000Z");
  const inviteUrl = buildInviteActionUrl(
    baseEnvironment.APP_BASE_URL,
    "invite_1234567890abcdefghijklmnop"
  );
  const verificationUrl = buildVerificationActionUrl(
    baseEnvironment.APP_BASE_URL,
    "verify_1234567890abcdefghijklmnop"
  );
  const resetUrl = buildPasswordResetActionUrl(
    baseEnvironment.APP_BASE_URL,
    "reset_1234567890abcdefghijklmnop"
  );

  it("renders invite, verification, and reset actions without accepting family context", () => {
    const privateArchiveName = "The Extremely Private Family Archive";
    const familySecret = "family-secret-marker";
    const invite = renderInviteEmail({
      actionUrl: inviteUrl,
      expiresAt,
      archiveName: privateArchiveName,
      secret: familySecret
    } as Parameters<typeof renderInviteEmail>[0]);
    const verification = renderVerificationEmail({ actionUrl: verificationUrl, expiresAt });
    const reset = renderPasswordResetEmail({ actionUrl: resetUrl, expiresAt });

    expect(invite.kind).toBe("invite");
    expect(verification.kind).toBe("verification");
    expect(reset.kind).toBe("password-reset");
    expect(invite.html).toContain(inviteUrl);
    expect(verification.text).toContain(verificationUrl);
    expect(reset.html).toContain(resetUrl);
    expect(JSON.stringify([invite, verification, reset])).not.toContain(privateArchiveName);
    expect(JSON.stringify([invite, verification, reset])).not.toContain(familySecret);
  });

  it("renders fixed-copy password and security notifications without arbitrary details", () => {
    const passwordChanged = renderPasswordChangedEmail({ occurredAt });
    const sessionsRevoked = renderSecurityNotificationEmail({
      event: "sessions-revoked",
      occurredAt
    });

    expect(passwordChanged.kind).toBe("password-changed");
    expect(passwordChanged.text).toMatch(/password.*changed/i);
    expect(sessionsRevoked.kind).toBe("security-notification");
    expect(sessionsRevoked.text).toMatch(/sessions.*signed out/i);
    expect(JSON.stringify([passwordChanged, sessionsRevoked])).toContain("beta@kinresolve.com");
  });

  it("fails closed for mismatched action URLs and invalid dates", () => {
    expect(() => renderInviteEmail({ actionUrl: verificationUrl as never, expiresAt })).toThrow(/invite.*URL/i);
    expect(() => renderVerificationEmail({
      actionUrl: verificationUrl,
      expiresAt: new Date("invalid")
    })).toThrow(/expiration/i);
  });
});

describe("Resend transactional email transport", () => {
  it("sends the provider-neutral message through the Resend HTTP API", async () => {
    const fetchImplementation = vi.fn<FetchLike>(async () => new Response(
      JSON.stringify({ id: "email_018f7e4e713a7b758b2e0282d1307839" }),
      { status: 200, headers: { "content-type": "application/json" } }
    ));

    const result = await configuredTransport(fetchImplementation).send(exampleMessage());

    expect(result).toEqual({
      provider: "resend",
      messageId: "email_018f7e4e713a7b758b2e0282d1307839"
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [input, init] = fetchImplementation.mock.calls[0];
    expect(input).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.cache).toBe("no-store");
    expect(init?.credentials).toBe("omit");
    expect(init?.referrerPolicy).toBe("no-referrer");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers)).toEqual(expect.objectContaining({}));
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${baseEnvironment.RESEND_API_KEY}`);
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(exampleMessage().idempotencyKey);
    expect(JSON.parse(String(init?.body))).toEqual({
      from: baseEnvironment.KINRESOLVE_TRANSACTIONAL_EMAIL_FROM,
      to: [exampleMessage().to],
      reply_to: baseEnvironment.KINRESOLVE_TRANSACTIONAL_EMAIL_REPLY_TO,
      subject: exampleMessage().subject,
      text: exampleMessage().text,
      html: exampleMessage().html
    });
    expect(String(init?.body)).not.toContain(baseEnvironment.RESEND_API_KEY);
  });

  it("returns redacted errors for provider rejection without reading its response body", async () => {
    const providerLeak = "provider echoed re_secret and reset_token_secret";
    const response = new Response(providerLeak, {
      status: 422,
      headers: { "x-request-id": "request_safe-123" }
    });
    const text = vi.spyOn(response, "text");
    const json = vi.spyOn(response, "json");
    const transport = configuredTransport(async () => response);

    const error = await transport.send(exampleMessage()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TransactionalEmailDeliveryError);
    expect(error).toMatchObject({
      code: "provider-rejected",
      status: 422,
      providerRequestId: "request_safe-123"
    });
    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(providerLeak);
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(exampleMessage().to);
  });

  it("redacts network failures and malformed provider success payloads", async () => {
    const networkLeak = "request contained researcher@example.com and re_secret_key";
    const networkError = await configuredTransport(async () => {
      throw new Error(networkLeak);
    }).send(exampleMessage()).catch((caught: unknown) => caught);

    const malformedError = await configuredTransport(async () => new Response(
      JSON.stringify({ id: "bad id with spaces", detail: networkLeak }),
      { status: 200, headers: { "content-type": "application/json" } }
    )).send(exampleMessage()).catch((caught: unknown) => caught);

    expect(networkError).toMatchObject({ code: "provider-unavailable" });
    expect(malformedError).toMatchObject({ code: "invalid-provider-response" });
    expect(`${String(networkError)} ${JSON.stringify(networkError)}`).not.toContain(networkLeak);
    expect(`${String(malformedError)} ${JSON.stringify(malformedError)}`).not.toContain(networkLeak);
  });

  it("bounds both response headers and response-body delivery", async () => {
    const privateMarker = "private-timeout-provider-marker";
    const headerTimeout = configuredTransport(
      (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error(privateMarker)));
      }),
      { timeoutMs: 5 }
    ).send(exampleMessage()).catch((caught: unknown) => caught);

    const delayedResponse = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ id: "email_late" })));
          controller.close();
        }, 40);
      }
    }), {
      headers: { "content-type": "application/json" },
      status: 200
    });
    const bodyTimeout = configuredTransport(
      async () => delayedResponse,
      { timeoutMs: 5 }
    ).send(exampleMessage()).catch((caught: unknown) => caught);

    const [headerError, bodyError] = await Promise.all([headerTimeout, bodyTimeout]);
    expect(headerError).toMatchObject({ code: "provider-unavailable" });
    expect(bodyError).toMatchObject({ code: "provider-unavailable" });
    expect(`${String(headerError)} ${String(bodyError)}`).not.toContain(privateMarker);
  });

  it("rejects redirects and oversized success bodies without exposing provider content", async () => {
    const privateMarker = "private-oversized-provider-marker";
    const redirected = new Response(JSON.stringify({ id: "email_redirected" }), {
      headers: { "content-type": "application/json" },
      status: 200
    });
    Object.defineProperty(redirected, "redirected", { value: true });
    const redirectError = await configuredTransport(async () => redirected)
      .send(exampleMessage())
      .catch((caught: unknown) => caught);

    const oversized = new Response(JSON.stringify({
      id: "email_oversized",
      privateMarker: privateMarker.repeat(1_000)
    }), {
      headers: { "content-type": "application/json" },
      status: 200
    });
    const oversizedError = await configuredTransport(async () => oversized)
      .send(exampleMessage())
      .catch((caught: unknown) => caught);

    expect(redirectError).toMatchObject({ code: "invalid-provider-response" });
    expect(oversizedError).toMatchObject({ code: "invalid-provider-response" });
    expect(`${String(redirectError)} ${JSON.stringify(redirectError)}`).not.toContain(privateMarker);
    expect(`${String(oversizedError)} ${JSON.stringify(oversizedError)}`).not.toContain(privateMarker);
  });

  it("rejects unsafe envelope fields before making an HTTP request", async () => {
    const fetchImplementation = vi.fn<FetchLike>();
    const transport = configuredTransport(fetchImplementation);
    const unsafe = {
      ...exampleMessage(),
      to: "researcher@example.com\r\nBcc: leak@example.com"
    };

    await expect(transport.send(unsafe)).rejects.toMatchObject({ code: "invalid-message" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
