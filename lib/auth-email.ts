import { createHash, randomUUID } from "node:crypto";
import { after } from "next/server";

import { readArchiveIdSetting } from "@/lib/environment-aliases";

import {
  buildPasswordResetActionUrl,
  createTransactionalEmailIdempotencyKey,
  createTransactionalEmailTransport,
  parseTransactionalEmailConfig,
  type TransactionalEmailConfig,
  type TransactionalEmailEnvironment,
  type TransactionalEmailMessage,
  type TransactionalEmailTransport
} from "@/lib/transactional-email";
import {
  renderPasswordChangedEmail,
  renderPasswordResetEmail,
  renderSecurityNotificationEmail,
  type TransactionalEmailTemplate
} from "@/lib/transactional-email-templates";

export const passwordResetTokenExpiresInSeconds = 30 * 60;

type AuthEmailUser = Readonly<{
  id: string;
  email: string;
}>;

type SendResetPasswordInput = Readonly<{
  user: AuthEmailUser;
  url: string;
  token: string;
}>;

type PasswordResetNotificationInput = Readonly<{
  user: AuthEmailUser;
}>;

type SessionsRevokedNotificationInput = Readonly<{
  requestId?: string;
  user: AuthEmailUser;
}>;

export type AuthEmailSecurityAuditEventType =
  | "password-changed"
  | "password-recovery-completed"
  | "password-recovery-requested"
  | "security-notification-delivered"
  | "security-notification-delivery-failed"
  | "sessions-revoked";

export type AuthEmailSecurityAuditInput = Readonly<{
  actorKind: "participant" | "system";
  eventType: AuthEmailSecurityAuditEventType;
  requestId: string;
  subject: string;
}>;

export type AuthEmailSecurityAuditRecorder = (
  input: AuthEmailSecurityAuditInput
) => Promise<void>;

export type AuthEmailDeferredTask = () => Promise<void>;
export type AuthEmailTaskScheduler = (task: AuthEmailDeferredTask) => void;

export type HostedPasswordRecoveryDependencies = Readonly<{
  environment?: TransactionalEmailEnvironment;
  createTransport?: (config: TransactionalEmailConfig) => TransactionalEmailTransport;
  recordSecurityAudit?: AuthEmailSecurityAuditRecorder;
  schedule?: AuthEmailTaskScheduler;
  now?: () => Date;
}>;

export type HostedPasswordRecovery = Readonly<{
  sendResetPassword: (
    data: SendResetPasswordInput,
    request?: Request
  ) => Promise<void>;
  onPasswordReset: (
    data: PasswordResetNotificationInput,
    request?: Request
  ) => Promise<void>;
  notifySessionsRevoked: (
    data: SessionsRevokedNotificationInput
  ) => Promise<void>;
  backgroundTaskHandler: (promise: Promise<unknown>) => void;
}>;

type AfterImplementation = (task: AuthEmailDeferredTask) => void;

export function createNextAfterScheduler(
  afterImplementation: AfterImplementation = after
): AuthEmailTaskScheduler {
  return (task) => {
    try {
      afterImplementation(task);
    } catch {
      // An absent request context must not turn a generic auth response into
      // an account-existence or provider-configuration oracle.
    }
  };
}

export function createHostedPasswordRecovery(
  dependencies: HostedPasswordRecoveryDependencies = {}
): HostedPasswordRecovery {
  const environment = dependencies.environment ?? process.env;
  const createTransport = dependencies.createTransport
    ?? ((config: TransactionalEmailConfig) => createTransactionalEmailTransport(config));
  const schedule = dependencies.schedule ?? createNextAfterScheduler();
  const now = dependencies.now ?? (() => new Date());
  const recordSecurityAudit = dependencies.recordSecurityAudit
    ?? ((input: AuthEmailSecurityAuditInput) => recordHostedSecurityAudit(
      input,
      readArchiveIdSetting(environment)
    ));

  const deliverResetPassword = async (data: SendResetPasswordInput): Promise<void> => {
    const config = parseTransactionalEmailConfig(environment);
    const actionUrl = buildPasswordResetActionUrl(config.appBaseUrl, data.token);
    const expiresAt = new Date(now().getTime() + passwordResetTokenExpiresInSeconds * 1_000);
    const template = renderPasswordResetEmail({ actionUrl, expiresAt });
    const idempotencyKey = createTransactionalEmailIdempotencyKey(
      "password-reset",
      opaqueDigest("password-reset", data.token)
    );
    await createTransport(config).send(toMessage(template, data.user.email, idempotencyKey));
  };

  const deliverPasswordChanged = async (data: PasswordResetNotificationInput): Promise<void> => {
    const occurredAt = now();
    const config = parseTransactionalEmailConfig(environment);
    const template = renderPasswordChangedEmail({ occurredAt });
    const idempotencyKey = createTransactionalEmailIdempotencyKey(
      "password-changed",
      opaqueDigest("password-changed", data.user.id, occurredAt.toISOString())
    );
    await createTransport(config).send(toMessage(template, data.user.email, idempotencyKey));
  };

  const deliverSessionsRevoked = async (
    data: SessionsRevokedNotificationInput,
    requestId: string
  ): Promise<void> => {
    const occurredAt = now();
    const config = parseTransactionalEmailConfig(environment);
    const template = renderSecurityNotificationEmail({
      event: "sessions-revoked",
      occurredAt
    });
    const idempotencyKey = createTransactionalEmailIdempotencyKey(
      "security-notification",
      opaqueDigest("sessions-revoked", data.user.id, requestId)
    );
    await createTransport(config).send(toMessage(template, data.user.email, idempotencyKey));
  };

  return {
    async sendResetPassword(data) {
      scheduleSafely(schedule, async () => {
        const requestId = randomUUID();
        await Promise.all([
          recordAuditSafely(recordSecurityAudit, {
            actorKind: "system",
            eventType: "password-recovery-requested",
            requestId,
            subject: data.user.id
          }),
          deliverWithAudit(
            () => deliverResetPassword(data),
            data.user.id,
            requestId,
            recordSecurityAudit
          )
        ]);
      });
    },
    async onPasswordReset(data) {
      scheduleSafely(schedule, async () => {
        const requestId = randomUUID();
        await Promise.all([
          recordAuditSafely(recordSecurityAudit, {
            actorKind: "participant",
            eventType: "password-recovery-completed",
            requestId,
            subject: data.user.id
          }),
          recordAuditSafely(recordSecurityAudit, {
            actorKind: "participant",
            eventType: "password-changed",
            requestId,
            subject: data.user.id
          }),
          deliverWithAudit(
            () => deliverPasswordChanged(data),
            data.user.id,
            requestId,
            recordSecurityAudit
          )
        ]);
      });
    },
    async notifySessionsRevoked(data) {
      scheduleSafely(schedule, async () => {
        const requestId = validRequestId(data.requestId) ?? randomUUID();
        await Promise.all([
          recordAuditSafely(recordSecurityAudit, {
            actorKind: "participant",
            eventType: "sessions-revoked",
            requestId,
            subject: data.user.id
          }),
          deliverWithAudit(
            () => deliverSessionsRevoked(data, requestId),
            data.user.id,
            requestId,
            recordSecurityAudit
          )
        ]);
      });
    },
    backgroundTaskHandler(promise) {
      const containedPromise = Promise.resolve(promise).then(
        () => undefined,
        () => undefined
      );
      scheduleSafely(schedule, async () => { await containedPromise; });
    }
  };
}

export async function notifyHostedSessionsRevoked(
  input: SessionsRevokedNotificationInput,
  dependencies: HostedPasswordRecoveryDependencies = {}
): Promise<void> {
  await createHostedPasswordRecovery(dependencies).notifySessionsRevoked(input);
}

function toMessage(
  template: TransactionalEmailTemplate,
  to: string,
  idempotencyKey: TransactionalEmailMessage["idempotencyKey"]
): TransactionalEmailMessage {
  return {
    kind: template.kind,
    to,
    idempotencyKey,
    subject: template.subject,
    text: template.text,
    html: template.html
  };
}

function scheduleSafely(
  schedule: AuthEmailTaskScheduler,
  task: AuthEmailDeferredTask
): void {
  const containedTask = async (): Promise<void> => {
    await discardFailure(task);
  };
  try {
    schedule(containedTask);
  } catch {
    // The caller must continue even when the runtime cannot retain the task.
  }
}

async function deliverWithAudit(
  deliver: AuthEmailDeferredTask,
  subject: string,
  requestId: string,
  recordSecurityAudit: AuthEmailSecurityAuditRecorder
): Promise<void> {
  let eventType: Extract<
    AuthEmailSecurityAuditEventType,
    "security-notification-delivered" | "security-notification-delivery-failed"
  > = "security-notification-delivered";
  try {
    await deliver();
  } catch {
    eventType = "security-notification-delivery-failed";
  }
  await recordAuditSafely(recordSecurityAudit, {
    actorKind: "system",
    eventType,
    requestId,
    subject
  });
}

async function recordAuditSafely(
  recordSecurityAudit: AuthEmailSecurityAuditRecorder,
  input: AuthEmailSecurityAuditInput
): Promise<void> {
  await discardFailure(() => recordSecurityAudit(input));
}

async function discardFailure(task: AuthEmailDeferredTask): Promise<void> {
  try {
    await task();
  } catch {
    // Delivery errors are intentionally redacted and contained. Auth and
    // session revocation outcomes must not depend on the email provider.
  }
}

function opaqueDigest(purpose: string, ...values: string[]): string {
  const digest = createHash("sha256");
  digest.update("kinresolve-auth-email-v1\0", "utf8");
  digest.update(purpose, "utf8");
  for (const value of values) {
    digest.update("\0", "utf8");
    digest.update(value, "utf8");
  }
  return digest.digest("hex");
}

function validRequestId(value: string | undefined): string | undefined {
  return value !== undefined
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

async function recordHostedSecurityAudit(
  input: AuthEmailSecurityAuditInput,
  configuredArchiveId: string | undefined
): Promise<void> {
  const [{ recordBetaSecurityAuditEvent }, { getArchiveId }] = await Promise.all([
    import("@/lib/beta-invitations"),
    import("@/lib/workspace-store")
  ]);
  await recordBetaSecurityAuditEvent(input, {
    archiveId: configuredArchiveId ?? getArchiveId()
  });
}
