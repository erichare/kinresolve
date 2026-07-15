import { createHmac, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { query, withTransaction, type DatabaseOptions } from "./db";
import {
  createTransactionalEmailIdempotencyKey,
  createTransactionalEmailTransport,
  isTransactionalEmailAddress,
  parseTransactionalEmailConfig,
  type TransactionalEmailEnvironment,
  type TransactionalEmailTransport
} from "./transactional-email";
import {
  renderBetaApplicationFounderEmail,
  renderBetaApplicationReceiptEmail
} from "./transactional-email-templates";
import {
  forbiddenWorkflowOnlyEnvironmentNames,
  requiredSensitiveProductionEnvironmentNames
} from "./vercel-environment-contract";

export const betaApplicationConsentVersion = "beta-communications-v1" as const;
export const betaApplicationFounderMailbox = "beta@kinresolve.com" as const;
export const betaApplicationMarketingOrigin = "https://kinresolve.com" as const;
export const betaApplicationThanksUrl = "https://kinresolve.com/beta/thanks/" as const;
export const betaApplicationRetentionDays = 90 as const;

export const betaApplicationResearcherTypes = [
  "family-historian",
  "professional-genealogist",
  "society-member",
  "developer-self-hoster",
  "other-researcher"
] as const;

export const betaApplicationWorkflows = [
  "gedcom-review",
  "source-research",
  "research-cases",
  "deterministic-quality",
  "developer-api"
] as const;

export const betaApplicationArchiveSizeBands = [
  "prefer-not-to-say",
  "under-1000",
  "1000-10000",
  "10000-50000",
  "over-50000"
] as const;

export const betaApplicationCurrentTools = [
  "ancestry",
  "family-tree-maker",
  "rootsmagic",
  "gramps",
  "familysearch",
  "legacy-family-tree",
  "other"
] as const;

export type BetaApplicationResearcherType = (typeof betaApplicationResearcherTypes)[number];
export type BetaApplicationWorkflow = (typeof betaApplicationWorkflows)[number];
export type BetaApplicationArchiveSizeBand = (typeof betaApplicationArchiveSizeBands)[number];
export type BetaApplicationCurrentTool = (typeof betaApplicationCurrentTools)[number];
export type BetaApplicationEnvironment = TransactionalEmailEnvironment;

export type NormalizedBetaApplication = Readonly<{
  archiveSizeBand: BetaApplicationArchiveSizeBand;
  consentVersion: typeof betaApplicationConsentVersion;
  currentTool: BetaApplicationCurrentTool | null;
  email: string;
  name: string;
  researcherType: BetaApplicationResearcherType;
  workflow: BetaApplicationWorkflow;
}>;

export type BetaApplicationPublicRecord = NormalizedBetaApplication & Readonly<{
  applicationId: string;
  consentedAt: string;
  createdAt: string;
  state: "pending" | "reviewing" | "invited" | "declined" | "withdrawn";
}>;

export type BetaApplicationRuntimeConfiguration = Readonly<{
  enabled: boolean;
  hmacSecret?: string;
}>;

export type BetaApplicationServiceOptions = DatabaseOptions & Readonly<{
  environment?: BetaApplicationEnvironment;
  now?: () => Date;
  transport?: TransactionalEmailTransport;
}>;

export type BetaApplicationErrorCode =
  | "DELIVERY_FAILED"
  | "INVALID_CONFIGURATION"
  | "INVALID_INPUT"
  | "OPERATION_FAILED";

const errorMessages: Record<BetaApplicationErrorCode, string> = {
  DELIVERY_FAILED: "The beta application was saved, but its confirmation could not be delivered.",
  INVALID_CONFIGURATION: "The beta application service is unavailable.",
  INVALID_INPUT: "The beta application is invalid.",
  OPERATION_FAILED: "The beta application could not be processed."
};

export class BetaApplicationError extends Error {
  constructor(readonly code: BetaApplicationErrorCode) {
    super(errorMessages[code]);
    this.name = "BetaApplicationError";
  }
}

type ApplicationRow = {
  id: string;
  submission_day: string | Date;
  submission_digest: string;
  email_digest: string;
  name: string;
  email: string;
  researcher_type: BetaApplicationResearcherType;
  workflow: BetaApplicationWorkflow;
  archive_size_band: BetaApplicationArchiveSizeBand;
  current_tool: BetaApplicationCurrentTool | null;
  consent_version: typeof betaApplicationConsentVersion;
  consented_at: Date;
  state: BetaApplicationPublicRecord["state"];
  applicant_delivery_state: "pending" | "sent";
  applicant_delivery_provider: string | null;
  applicant_delivery_message_digest: string | null;
  founder_delivery_state: "pending" | "sent";
  founder_delivery_provider: string | null;
  founder_delivery_message_digest: string | null;
  created_at: Date;
};

const providerIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const hmacDomain = "kinresolve-beta-application-v1";
const additionalCredentialEnvironmentNames = [
  "AI_API_KEY",
  "KINSLEUTH_APP_PASSWORD",
  "MINIO_ROOT_PASSWORD",
  "MINIO_ROOT_USER",
  "OPENAI_API_KEY",
  "PGPASSWORD",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY"
] as const;
const applicationHmacDistinctCredentialEnvironmentNames = new Set<string>([
  ...requiredSensitiveProductionEnvironmentNames,
  ...forbiddenWorkflowOnlyEnvironmentNames,
  ...additionalCredentialEnvironmentNames
]);
const structuredDatabaseCredentialEnvironmentNames = [
  "ADMIN_DATABASE_URL",
  "DATABASE_ADMIN_URL",
  "DATABASE_IDENTITY_URL",
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "RECOVERY_DATABASE_URL",
  "RECOVERY_SOURCE_DATABASE_URL",
  "RECOVERY_TARGET_DATABASE_URL",
  "RECOVERY_TARGET_RUNTIME_DATABASE_URL",
  "RELEASE_FENCE_DATABASE_URL"
] as const;

export function betaApplicationsEnabled(
  environment: BetaApplicationEnvironment = process.env
): boolean {
  const value = environment.KINRESOLVE_BETA_APPLICATIONS_ENABLED;
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new BetaApplicationError("INVALID_CONFIGURATION");
}

export function betaApplicationRuntimeConfiguration(
  environment: BetaApplicationEnvironment = process.env
): BetaApplicationRuntimeConfiguration {
  if (!betaApplicationsEnabled(environment)) return { enabled: false };
  const hmacSecret = environment.KINRESOLVE_BETA_APPLICATION_HMAC_SECRET;
  if (
    typeof hmacSecret !== "string"
    || hmacSecret !== hmacSecret.trim()
    || Buffer.byteLength(hmacSecret, "utf8") < 32
    || Buffer.byteLength(hmacSecret, "utf8") > 1024
  ) {
    throw new BetaApplicationError("INVALID_CONFIGURATION");
  }
  for (const name of applicationHmacDistinctCredentialEnvironmentNames) {
    if (name === "KINRESOLVE_BETA_APPLICATION_HMAC_SECRET") continue;
    if (environment[name]?.trim() === hmacSecret) {
      throw new BetaApplicationError("INVALID_CONFIGURATION");
    }
  }
  for (const name of structuredDatabaseCredentialEnvironmentNames) {
    const value = environment[name]?.trim();
    if (!value) continue;
    if (databaseUrlCredentials(value).some((credential) => credential === hmacSecret)) {
      throw new BetaApplicationError("INVALID_CONFIGURATION");
    }
  }
  return { enabled: true, hmacSecret };
}

function databaseUrlCredentials(value: string): string[] {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return [];
    return [parsed.username, parsed.password]
      .filter((credential) => credential.length > 0)
      .map((credential) => {
        try {
          return decodeURIComponent(credential);
        } catch {
          return credential;
        }
      });
  } catch {
    return [];
  }
}

export function normalizeBetaApplication(input: Readonly<{
  archiveSizeBand: string;
  consentVersion: string;
  currentTool?: string | null;
  email: string;
  name: string;
  researcherType: string;
  workflow: string;
}>): NormalizedBetaApplication {
  try {
    const name = normalizeText(input.name, 100, false);
    const email = normalizeEmail(input.email);
    const currentTool = input.currentTool === undefined || input.currentTool === null || input.currentTool === ""
      ? null
      : input.currentTool;
    if (
      !betaApplicationResearcherTypes.includes(input.researcherType as BetaApplicationResearcherType)
      || !betaApplicationWorkflows.includes(input.workflow as BetaApplicationWorkflow)
      || !betaApplicationArchiveSizeBands.includes(input.archiveSizeBand as BetaApplicationArchiveSizeBand)
      || (currentTool !== null && !betaApplicationCurrentTools.includes(currentTool as BetaApplicationCurrentTool))
      || input.consentVersion !== betaApplicationConsentVersion
    ) {
      throw new Error("invalid enum");
    }
    return Object.freeze({
      archiveSizeBand: input.archiveSizeBand as BetaApplicationArchiveSizeBand,
      consentVersion: betaApplicationConsentVersion,
      currentTool: currentTool as BetaApplicationCurrentTool | null,
      email,
      name,
      researcherType: input.researcherType as BetaApplicationResearcherType,
      workflow: input.workflow as BetaApplicationWorkflow
    });
  } catch {
    throw new BetaApplicationError("INVALID_INPUT");
  }
}

export function deriveBetaApplicationDigest(
  kind: "email" | "provider-message" | "submission",
  value: string,
  hmacSecret: string
): string {
  if (
    !["email", "provider-message", "submission"].includes(kind)
    || typeof value !== "string"
    || Buffer.byteLength(value, "utf8") < 1
    || Buffer.byteLength(value, "utf8") > 4096
  ) {
    throw new BetaApplicationError("INVALID_INPUT");
  }
  if (Buffer.byteLength(hmacSecret, "utf8") < 32) {
    throw new BetaApplicationError("INVALID_CONFIGURATION");
  }
  return createHmac("sha256", hmacSecret)
    .update(hmacDomain, "utf8")
    .update("\0", "utf8")
    .update(kind, "utf8")
    .update("\0", "utf8")
    .update(value, "utf8")
    .digest("hex");
}

export async function submitBetaApplication(
  application: NormalizedBetaApplication,
  options: BetaApplicationServiceOptions = {}
): Promise<Readonly<{ applicationId: string; duplicate: boolean }>> {
  const environment = options.environment ?? process.env;
  const configuration = betaApplicationRuntimeConfiguration(environment);
  if (!configuration.enabled || !configuration.hmacSecret) {
    throw new BetaApplicationError("INVALID_CONFIGURATION");
  }
  const now = requiredDate((options.now ?? (() => new Date()))());
  const submissionDay = now.toISOString().slice(0, 10);
  const canonicalApplication = canonicalApplicationValue(application);
  const submissionDigest = deriveBetaApplicationDigest(
    "submission",
    `${submissionDay}\0${canonicalApplication}`,
    configuration.hmacSecret
  );
  const emailDigest = deriveBetaApplicationDigest("email", application.email, configuration.hmacSecret);
  const applicationId = randomUUID();

  let persisted: { duplicate: boolean; row: ApplicationRow };
  try {
    persisted = await withTransaction(options, async (client) => {
      const inserted = await client.query<ApplicationRow>(
        `INSERT INTO public.beta_applications (
           id, submission_day, submission_digest, email_digest,
           name, email, researcher_type, workflow, archive_size_band, current_tool,
           consent_version, consented_at, created_at, updated_at, retention_expires_at
         )
         VALUES (
           $1::uuid, $2::date, $3, $4,
           $5, $6, $7, $8, $9, $10,
           $11, $12::timestamptz, $12::timestamptz, $12::timestamptz,
           $12::timestamptz + interval '90 days'
         )
         ON CONFLICT (submission_day, submission_digest) DO NOTHING
         RETURNING *`,
        [
          applicationId,
          submissionDay,
          submissionDigest,
          emailDigest,
          application.name,
          application.email,
          application.researcherType,
          application.workflow,
          application.archiveSizeBand,
          application.currentTool,
          application.consentVersion,
          now
        ]
      );
      const insertedRow = inserted.rows[0];
      if (insertedRow) return { duplicate: false, row: insertedRow };
      const existing = await client.query<ApplicationRow>(
        `SELECT *
         FROM public.beta_applications
         WHERE submission_day = $1::date AND submission_digest = $2
         FOR UPDATE`,
        [submissionDay, submissionDigest]
      );
      const row = existing.rows[0];
      if (!row || !rowMatchesApplication(row, application, submissionDigest, emailDigest, submissionDay)) {
        throw new Error("application conflict mismatch");
      }
      return { duplicate: true, row };
    });
  } catch {
    throw new BetaApplicationError("OPERATION_FAILED");
  }

  let row = persisted.row;
  if (row.applicant_delivery_state === "sent" && row.founder_delivery_state === "sent") {
    return Object.freeze({ applicationId: row.id, duplicate: persisted.duplicate });
  }

  try {
    row = await recordDeliveryAttempt(row.id, options);
  } catch {
    throw new BetaApplicationError("OPERATION_FAILED");
  }

  let transport: TransactionalEmailTransport;
  try {
    transport = options.transport
      ?? createTransactionalEmailTransport(parseTransactionalEmailConfig(environment));
  } catch {
    throw new BetaApplicationError("DELIVERY_FAILED");
  }

  let deliveryFailed = false;
  if (row.applicant_delivery_state !== "sent") {
    try {
      const template = renderBetaApplicationReceiptEmail({
        applicationId: row.id,
        name: application.name
      });
      const delivery = await transport.send({
        ...template,
        to: application.email,
        idempotencyKey: createTransactionalEmailIdempotencyKey("application-receipt", row.id)
      });
      row = await markDeliverySent(
        row.id,
        "applicant",
        delivery,
        configuration.hmacSecret,
        options
      );
    } catch {
      deliveryFailed = true;
    }
  }
  if (row.founder_delivery_state !== "sent") {
    try {
      const template = renderBetaApplicationFounderEmail({
        applicationId: row.id,
        archiveSizeBand: application.archiveSizeBand,
        currentTool: application.currentTool,
        email: application.email,
        name: application.name,
        researcherType: application.researcherType,
        workflow: application.workflow
      });
      const delivery = await transport.send({
        ...template,
        to: betaApplicationFounderMailbox,
        idempotencyKey: createTransactionalEmailIdempotencyKey("application-founder", row.id)
      });
      await markDeliverySent(
        row.id,
        "founder",
        delivery,
        configuration.hmacSecret,
        options
      );
    } catch {
      deliveryFailed = true;
    }
  }
  if (deliveryFailed) {
    throw new BetaApplicationError("DELIVERY_FAILED");
  }

  return Object.freeze({ applicationId: row.id, duplicate: persisted.duplicate });
}

export async function readBetaApplicationsForEmail(
  emailInput: string,
  options: DatabaseOptions = {}
): Promise<BetaApplicationPublicRecord[]> {
  const email = normalizeEmailSafe(emailInput);
  try {
    const result = await query<ApplicationRow>(
      `SELECT *
       FROM public.beta_applications
       WHERE email = $1
       ORDER BY created_at, id`,
      [email],
      options
    );
    return result.rows.map(publicRecord);
  } catch {
    throw new BetaApplicationError("OPERATION_FAILED");
  }
}

export async function deleteBetaApplicationsForEmail(
  emailInput: string,
  options: DatabaseOptions = {}
): Promise<Readonly<{ deletedCount: number }>> {
  const email = normalizeEmailSafe(emailInput);
  try {
    const result = await query(
      `DELETE FROM public.beta_applications WHERE email = $1`,
      [email],
      options
    );
    return Object.freeze({ deletedCount: result.rowCount ?? 0 });
  } catch {
    throw new BetaApplicationError("OPERATION_FAILED");
  }
}

export async function cleanupExpiredBetaApplicationsInTransaction(
  client: PoolClient,
  limit: number
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new BetaApplicationError("INVALID_INPUT");
  }
  const result = await client.query(
    `WITH expired AS (
       SELECT ctid
       FROM public.beta_applications
       WHERE retention_expires_at <= clock_timestamp()
       ORDER BY retention_expires_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     DELETE FROM public.beta_applications AS application
     USING expired
     WHERE application.ctid = expired.ctid`,
    [limit]
  );
  return result.rowCount ?? 0;
}

async function recordDeliveryAttempt(
  applicationId: string,
  options: DatabaseOptions
): Promise<ApplicationRow> {
  return withTransaction(options, async (client) => {
    const result = await client.query<ApplicationRow>(
      `WITH attempt AS (SELECT clock_timestamp() AS at)
       UPDATE public.beta_applications
       SET delivery_attempt_count = delivery_attempt_count + 1,
           last_delivery_attempt_at = GREATEST(
             created_at, COALESCE(last_delivery_attempt_at, created_at), attempt.at
           ),
           updated_at = GREATEST(updated_at, created_at, attempt.at)
       FROM attempt
       WHERE id = $1::uuid
         AND (applicant_delivery_state = 'pending' OR founder_delivery_state = 'pending')
         AND delivery_attempt_count < 100
       RETURNING *`,
      [applicationId]
    );
    const row = result.rows[0];
    if (!row) throw new Error("delivery attempt unavailable");
    return row;
  });
}

async function markDeliverySent(
  applicationId: string,
  kind: "applicant" | "founder",
  delivery: Readonly<{ provider: string; messageId: string }>,
  hmacSecret: string,
  options: DatabaseOptions
): Promise<ApplicationRow> {
  if (delivery.provider !== "resend" || !providerIdentifierPattern.test(delivery.messageId)) {
    throw new Error("invalid delivery receipt");
  }
  const messageDigest = deriveBetaApplicationDigest(
    "provider-message",
    `${kind}\0${delivery.provider}\0${delivery.messageId}`,
    hmacSecret
  );
  const stateColumn = `${kind}_delivery_state`;
  const providerColumn = `${kind}_delivery_provider`;
  const digestColumn = `${kind}_delivery_message_digest`;
  const deliveredAtColumn = `${kind}_delivered_at`;
  return withTransaction(options, async (client) => {
    const updated = await client.query<ApplicationRow>(
      `WITH delivery AS (SELECT clock_timestamp() AS at)
       UPDATE public.beta_applications
       SET ${stateColumn} = 'sent',
           ${providerColumn} = $2,
           ${digestColumn} = $3,
           ${deliveredAtColumn} = GREATEST(created_at, delivery.at),
           updated_at = GREATEST(updated_at, created_at, delivery.at)
       FROM delivery
       WHERE id = $1::uuid AND ${stateColumn} = 'pending'
       RETURNING *`,
      [applicationId, delivery.provider, messageDigest]
    );
    if (updated.rows[0]) return updated.rows[0];
    const existing = await client.query<ApplicationRow>(
      `SELECT * FROM public.beta_applications WHERE id = $1::uuid`,
      [applicationId]
    );
    const row = existing.rows[0];
    if (
      !row
      || row[stateColumn as keyof ApplicationRow] !== "sent"
      || row[providerColumn as keyof ApplicationRow] !== delivery.provider
      || row[digestColumn as keyof ApplicationRow] !== messageDigest
    ) {
      throw new Error("delivery state unavailable");
    }
    return row;
  });
}

function canonicalApplicationValue(application: NormalizedBetaApplication): string {
  return JSON.stringify({
    archiveSizeBand: application.archiveSizeBand,
    consentVersion: application.consentVersion,
    currentTool: application.currentTool,
    email: application.email,
    name: application.name,
    researcherType: application.researcherType,
    workflow: application.workflow
  });
}

function rowMatchesApplication(
  row: ApplicationRow,
  application: NormalizedBetaApplication,
  submissionDigest: string,
  emailDigest: string,
  submissionDay: string
): boolean {
  const rowDay = row.submission_day instanceof Date
    ? row.submission_day.toISOString().slice(0, 10)
    : String(row.submission_day).slice(0, 10);
  return rowDay === submissionDay
    && row.submission_digest === submissionDigest
    && row.email_digest === emailDigest
    && row.name === application.name
    && row.email === application.email
    && row.researcher_type === application.researcherType
    && row.workflow === application.workflow
    && row.archive_size_band === application.archiveSizeBand
    && row.current_tool === application.currentTool
    && row.consent_version === application.consentVersion;
}

function publicRecord(row: ApplicationRow): BetaApplicationPublicRecord {
  return Object.freeze({
    applicationId: row.id,
    archiveSizeBand: row.archive_size_band,
    consentVersion: row.consent_version,
    consentedAt: requiredDate(row.consented_at).toISOString(),
    createdAt: requiredDate(row.created_at).toISOString(),
    currentTool: row.current_tool,
    email: row.email,
    name: row.name,
    researcherType: row.researcher_type,
    state: row.state,
    workflow: row.workflow
  });
}

function normalizeEmail(value: string): string {
  if (typeof value !== "string") throw new Error("invalid email");
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (/\s|[\u0000-\u001f\u007f]/u.test(normalized)) throw new Error("invalid email");
  if (!isTransactionalEmailAddress(normalized)) throw new Error("invalid email");
  return normalized;
}

function normalizeEmailSafe(value: string): string {
  try {
    return normalizeEmail(value);
  } catch {
    throw new BetaApplicationError("INVALID_INPUT");
  }
}

function normalizeText(value: string, maximumLength: number, optional: false): string;
function normalizeText(value: string, maximumLength: number, optional: true): string | null;
function normalizeText(value: string, maximumLength: number, optional: boolean): string | null {
  if (typeof value !== "string") throw new Error("invalid text");
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (optional && normalized === "") return null;
  if (
    normalized.length < 1
    || normalized.length > maximumLength
    || /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new Error("invalid text");
  }
  return normalized;
}

function requiredDate(value: unknown): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new BetaApplicationError("INVALID_INPUT");
  return date;
}
