import { describe, expect, it, vi } from "vitest";

import { createBetaEmailDeliveries } from "@/lib/beta-email-delivery";
import {
  buildInviteActionUrl,
  buildVerificationActionUrl,
  type TransactionalEmailMessage,
  type TransactionalEmailTransport
} from "@/lib/transactional-email";

const environment = {
  APP_BASE_URL: "https://app.kinresolve.com",
  KINRESOLVE_TRANSACTIONAL_EMAIL_PROVIDER: "resend",
  KINRESOLVE_TRANSACTIONAL_EMAIL_FROM: "Kin Resolve <beta@kinresolve.com>",
  KINRESOLVE_TRANSACTIONAL_EMAIL_REPLY_TO: "beta@kinresolve.com",
  RESEND_API_KEY: "re_test_1234567890abcdefghijkl"
};

describe("beta onboarding email delivery", () => {
  it("sends fixed invite and verification templates with operation idempotency", async () => {
    const messages: TransactionalEmailMessage[] = [];
    const transport: TransactionalEmailTransport = {
      send: vi.fn(async (message) => {
        messages.push(message);
        return { provider: "test", messageId: `message-${messages.length}` };
      })
    };
    const deliveries = createBetaEmailDeliveries({
      environment,
      createTransport: () => transport
    });
    const expiresAt = new Date("2026-07-16T12:00:00.000Z");

    await deliveries.deliverInvitation({
      actionUrl: buildInviteActionUrl(environment.APP_BASE_URL, "invite_1234567890abcdefghijklmnop"),
      expiresAt,
      invitationId: "018f7e4e-713a-7b75-8b2e-0282d1307839",
      to: "pilot@example.com"
    });
    await deliveries.deliverVerification({
      actionUrl: buildVerificationActionUrl(environment.APP_BASE_URL, "verify_1234567890abcdefghijklmnop"),
      expiresAt,
      to: "pilot@example.com",
      verificationId: "018f7e4e-713a-7b75-8b2e-0282d1307840"
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      kind: "invite",
      idempotencyKey: "kinresolve:invite:018f7e4e-713a-7b75-8b2e-0282d1307839",
      to: "pilot@example.com"
    });
    expect(messages[1]).toMatchObject({
      kind: "verification",
      idempotencyKey: "kinresolve:verification:018f7e4e-713a-7b75-8b2e-0282d1307840",
      to: "pilot@example.com"
    });
    expect(JSON.stringify(messages)).not.toMatch(/archive|family|gedcom/i);
  });

  it("fails before creating a transport when hosted email configuration is incomplete", () => {
    const createTransport = vi.fn();
    expect(() => createBetaEmailDeliveries({
      environment: { ...environment, RESEND_API_KEY: undefined },
      createTransport
    })).toThrow(/API key configuration/i);
    expect(createTransport).not.toHaveBeenCalled();
  });
});
