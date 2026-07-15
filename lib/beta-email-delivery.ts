import type {
  DeliverBetaEmailVerification,
  DeliverBetaInvitation
} from "./beta-invitations";
import {
  createTransactionalEmailIdempotencyKey,
  createTransactionalEmailTransport,
  parseTransactionalEmailConfig,
  type TransactionalEmailConfig,
  type TransactionalEmailEnvironment,
  type TransactionalEmailTransport
} from "./transactional-email";
import {
  renderInviteEmail,
  renderVerificationEmail
} from "./transactional-email-templates";

type BetaEmailDeliveryDependencies = {
  createTransport?: (config: TransactionalEmailConfig) => TransactionalEmailTransport;
  environment?: TransactionalEmailEnvironment;
};

export function createBetaEmailDeliveries(
  dependencies: BetaEmailDeliveryDependencies = {}
): {
  appBaseUrl: string;
  deliverInvitation: DeliverBetaInvitation;
  deliverVerification: DeliverBetaEmailVerification;
} {
  const config = parseTransactionalEmailConfig(dependencies.environment ?? process.env);
  const transport = (dependencies.createTransport ?? createTransactionalEmailTransport)(config);

  return {
    appBaseUrl: config.appBaseUrl,
    async deliverInvitation(input) {
      const template = renderInviteEmail({ actionUrl: input.actionUrl, expiresAt: input.expiresAt });
      await transport.send({
        ...template,
        to: input.to,
        idempotencyKey: createTransactionalEmailIdempotencyKey("invite", input.invitationId)
      });
    },
    async deliverVerification(input) {
      const template = renderVerificationEmail({ actionUrl: input.actionUrl, expiresAt: input.expiresAt });
      await transport.send({
        ...template,
        to: input.to,
        idempotencyKey: createTransactionalEmailIdempotencyKey("verification", input.verificationId)
      });
    }
  };
}
