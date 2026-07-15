import {
  assertTransactionalActionUrl,
  type TransactionalActionUrl,
  type TransactionalEmailKind
} from "@/lib/transactional-email";

const supportEmail = "beta@kinresolve.com";

export type TransactionalEmailTemplate = Readonly<{
  kind: TransactionalEmailKind;
  subject: string;
  text: string;
  html: string;
}>;

type ExpiringActionInput<Kind extends "invite" | "verification" | "password-reset"> = Readonly<{
  actionUrl: TransactionalActionUrl<Kind>;
  expiresAt: Date;
}>;

export type SecurityNotificationEvent = "sessions-revoked" | "recovery-completed";

export function renderInviteEmail(
  input: ExpiringActionInput<"invite">
): TransactionalEmailTemplate {
  assertTransactionalActionUrl(input.actionUrl, "invite");
  const expiration = formatDate(input.expiresAt, "Invitation expiration");
  return renderActionTemplate({
    kind: "invite",
    subject: "Your Kin Resolve private beta invitation",
    heading: "You are invited to Kin Resolve",
    introduction: "Use this one-time link to accept your private beta invitation.",
    actionLabel: "Accept invitation",
    actionUrl: input.actionUrl,
    expiration
  });
}

export function renderVerificationEmail(
  input: ExpiringActionInput<"verification">
): TransactionalEmailTemplate {
  assertTransactionalActionUrl(input.actionUrl, "verification");
  const expiration = formatDate(input.expiresAt, "Verification expiration");
  return renderActionTemplate({
    kind: "verification",
    subject: "Verify your Kin Resolve email",
    heading: "Verify your email",
    introduction: "Use this one-time link to verify your Kin Resolve email address.",
    actionLabel: "Verify email",
    actionUrl: input.actionUrl,
    expiration
  });
}

export function renderPasswordResetEmail(
  input: ExpiringActionInput<"password-reset">
): TransactionalEmailTemplate {
  assertTransactionalActionUrl(input.actionUrl, "password-reset");
  const expiration = formatDate(input.expiresAt, "Password reset expiration");
  return renderActionTemplate({
    kind: "password-reset",
    subject: "Reset your Kin Resolve password",
    heading: "Reset your password",
    introduction: "Use this one-time link to choose a new Kin Resolve password.",
    actionLabel: "Reset password",
    actionUrl: input.actionUrl,
    expiration
  });
}

export function renderPasswordChangedEmail(
  input: Readonly<{ occurredAt: Date }>
): TransactionalEmailTemplate {
  const occurredAt = formatDate(input.occurredAt, "Password change time");
  return renderNotificationTemplate({
    kind: "password-changed",
    subject: "Your Kin Resolve password was changed",
    heading: "Password changed",
    statement: `Your Kin Resolve password was changed at ${occurredAt}.`
  });
}

export function renderSecurityNotificationEmail(
  input: Readonly<{ event: SecurityNotificationEvent; occurredAt: Date }>
): TransactionalEmailTemplate {
  const occurredAt = formatDate(input.occurredAt, "Security event time");
  if (input.event === "sessions-revoked") {
    return renderNotificationTemplate({
      kind: "security-notification",
      subject: "Your Kin Resolve sessions were signed out",
      heading: "Sessions signed out",
      statement: `All Kin Resolve sessions were signed out at ${occurredAt}.`
    });
  }
  if (input.event === "recovery-completed") {
    return renderNotificationTemplate({
      kind: "security-notification",
      subject: "Your Kin Resolve account recovery completed",
      heading: "Account recovery completed",
      statement: `Kin Resolve account recovery completed at ${occurredAt}.`
    });
  }
  throw new Error("Security notification event is invalid.");
}

function renderActionTemplate(input: Readonly<{
  kind: "invite" | "verification" | "password-reset";
  subject: string;
  heading: string;
  introduction: string;
  actionLabel: string;
  actionUrl: string;
  expiration: string;
}>): TransactionalEmailTemplate {
  const escapedUrl = escapeHtml(input.actionUrl);
  const text = [
    input.heading,
    "",
    input.introduction,
    "",
    input.actionUrl,
    "",
    `This link expires at ${input.expiration}.`,
    "Do not forward this email or share this link.",
    "",
    `If you did not expect this email, ignore it or contact ${supportEmail}.`
  ].join("\n");
  const html = renderHtmlDocument(
    input.heading,
    `<p>${escapeHtml(input.introduction)}</p>
<p><a href="${escapedUrl}">${escapeHtml(input.actionLabel)}</a></p>
<p>This link expires at ${escapeHtml(input.expiration)}. Do not forward this email or share this link.</p>
<p>If you did not expect this email, ignore it or contact <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>`
  );

  return Object.freeze({ kind: input.kind, subject: input.subject, text, html });
}

function renderNotificationTemplate(input: Readonly<{
  kind: "password-changed" | "security-notification";
  subject: string;
  heading: string;
  statement: string;
}>): TransactionalEmailTemplate {
  const warning = `If you did not make this change, contact ${supportEmail} immediately.`;
  return Object.freeze({
    kind: input.kind,
    subject: input.subject,
    text: [input.heading, "", input.statement, "", warning].join("\n"),
    html: renderHtmlDocument(
      input.heading,
      `<p>${escapeHtml(input.statement)}</p>
<p>If you did not make this change, contact <a href="mailto:${supportEmail}">${supportEmail}</a> immediately.</p>`
    )
  });
}

function renderHtmlDocument(heading: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body>
<main>
<h1>${escapeHtml(heading)}</h1>
${body}
</main>
</body>
</html>`;
}

function formatDate(value: Date, label: string): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label} is invalid.`);
  }
  return value.toUTCString();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
