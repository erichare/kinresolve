import { createHash } from "node:crypto";

import {
  identityCanaryMutationAcknowledgement,
  resolveInsecureLoopbackProductionCanaryProfile
} from "../lib/insecure-loopback-canary.ts";

export const identityBrowserCanaryMutationAcknowledgement =
  identityCanaryMutationAcknowledgement;

export const identityBrowserCanaryDatabaseName = "kinresolve_identity_canary";
export const identityBrowserCanaryArchiveId = "archive-identity-canary";

type Environment = Record<string, string | undefined>;

export type IdentityBrowserCanaryConfiguration = Readonly<{
  appBaseUrl: string;
  archiveId: string;
  databaseName: string;
  databaseUrl: string;
  headless: boolean;
  origin: string;
  runId: string;
  timeoutMs: number;
}>;

export type DisposableIdentityCounts = Readonly<{
  accounts: number;
  apiRateLimits: number;
  apiTokens: number;
  authRateLimits: number;
  betaAuditEvents: number;
  betaInvitations: number;
  betaOperatorNonces: number;
  betaTermsAcceptances: number;
  betaVerificationTokens: number;
  sessions: number;
  securityEvents: number;
  users: number;
  verifications: number;
}>;

const exactHostedSettings: Readonly<Record<string, string>> = Object.freeze({
  DATABASE_AUTO_MIGRATE: "false",
  KINRESOLVE_API_V1_ENABLED: "true",
  KINRESOLVE_DATASET_MODE: "demo",
  KINRESOLVE_DEPLOYMENT_MODE: "hosted",
  KINRESOLVE_DNA_ENABLED: "false",
  KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED: "false",
  KINRESOLVE_EXTERNAL_AI_ENABLED: "false",
  KINRESOLVE_PACKAGE_MEDIA_ENABLED: "false",
  KINRESOLVE_PLAIN_GEDCOM_ENABLED: "true",
  KINRESOLVE_PUBLIC_ARCHIVE_ENABLED: "false",
  KINRESOLVE_PUBLIC_PUBLISHING_ENABLED: "false",
  KINRESOLVE_SCHEDULED_WRITES_ENABLED: "false",
  KINSLEUTH_ALLOW_SIGNUPS: "false"
});

const forbiddenProviderSettings = [
  "AI_API_KEY",
  "OPENAI_API_KEY",
  "RESEND_API_KEY",
  "KINRESOLVE_TRANSACTIONAL_EMAIL_PROVIDER",
  "KINRESOLVE_TRANSACTIONAL_EMAIL_FROM",
  "KINRESOLVE_TRANSACTIONAL_EMAIL_REPLY_TO",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
  "VERCEL_ENV",
  "VERCEL"
] as const;

export function resolveIdentityBrowserCanaryConfiguration(
  environment: Environment = process.env
): IdentityBrowserCanaryConfiguration {
  if (environment.KINRESOLVE_IDENTITY_CANARY_ALLOW_MUTATION !== "true") {
    throw new Error("The disposable identity canary requires an exact mutation opt-in.");
  }
  if (
    environment.KINRESOLVE_IDENTITY_CANARY_MUTATION_ACKNOWLEDGEMENT
    !== identityBrowserCanaryMutationAcknowledgement
  ) {
    throw new Error("The disposable identity canary acknowledgement is invalid.");
  }

  for (const [name, expected] of Object.entries(exactHostedSettings)) {
    if (environment[name] !== expected) {
      throw new Error(`The disposable identity canary requires exact ${name}.`);
    }
  }
  for (const name of forbiddenProviderSettings) {
    if (environment[name]?.trim()) {
      throw new Error("The disposable identity canary refuses provider or deployment credentials.");
    }
  }
  if (environment.NODE_ENV !== "production") {
    throw new Error("The disposable identity canary requires the production server runtime.");
  }
  if (resolveInsecureLoopbackProductionCanaryProfile(environment) !== "identity") {
    throw new Error("The disposable identity canary requires the exact isolated loopback production profile.");
  }

  const origin = parseLoopbackOrigin(required(environment, "KINRESOLVE_IDENTITY_CANARY_ORIGIN"));
  const appBaseUrl = required(environment, "APP_BASE_URL");
  if (appBaseUrl !== origin) {
    throw new Error("The disposable identity canary requires an exact APP_BASE_URL origin binding.");
  }

  const databaseUrl = required(environment, "DATABASE_URL");
  const databaseName = parseDisposableDatabaseUrl(databaseUrl);
  const archiveId = required(environment, "KINSLEUTH_ARCHIVE_ID");
  if (archiveId !== identityBrowserCanaryArchiveId) {
    throw new Error("The disposable identity canary archive binding is invalid.");
  }

  const runId = required(environment, "KINRESOLVE_IDENTITY_CANARY_RUN_ID");
  if (!/^[a-z0-9][a-z0-9-]{7,63}$/.test(runId)) {
    throw new Error("The disposable identity canary run identifier is invalid.");
  }

  requirePrivateCredential(environment, "AUTH_SECRET");
  requirePrivateCredential(environment, "KINRESOLVE_API_CURSOR_SECRET");
  requirePrivateCredential(environment, "KINRESOLVE_BETA_PRIVACY_HMAC_SECRET");
  const credentials = new Set([
    environment.AUTH_SECRET,
    environment.KINRESOLVE_API_CURSOR_SECRET,
    environment.KINRESOLVE_BETA_PRIVACY_HMAC_SECRET
  ]);
  if (credentials.size !== 3) {
    throw new Error("The disposable identity canary requires distinct private credentials.");
  }

  return Object.freeze({
    appBaseUrl,
    archiveId,
    databaseName,
    databaseUrl,
    headless: optionalBoolean(environment.KINRESOLVE_IDENTITY_CANARY_HEADLESS, true),
    origin,
    runId,
    timeoutMs: optionalInteger(environment.KINRESOLVE_IDENTITY_CANARY_TIMEOUT_MS, 45_000, 5_000, 120_000)
  });
}

export function passwordResetIdentifierDigest(token: string): string {
  if (!/^[A-Za-z0-9_-]{16,512}$/.test(token)) {
    throw new Error("The synthetic password-reset token is invalid.");
  }
  return createHash("sha256")
    .update(`reset-password:${token}`, "utf8")
    .digest("base64url");
}

export function assertFreshDisposableIdentityCounts(counts: DisposableIdentityCounts): void {
  for (const [name, count] of Object.entries(counts)) {
    if (!Number.isSafeInteger(count) || count !== 0) {
      throw new Error(`The disposable identity database contains pre-existing ${name}.`);
    }
  }
}

function parseLoopbackOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("The disposable identity canary origin is invalid.");
  }
  const port = Number(parsed.port);
  if (
    parsed.protocol !== "http:"
    || parsed.hostname !== "127.0.0.1"
    || !Number.isInteger(port)
    || port < 1024
    || port > 65_535
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.pathname !== "/"
    || parsed.search !== ""
    || parsed.hash !== ""
    || parsed.href !== `${parsed.origin}/`
  ) {
    throw new Error("The disposable identity canary origin must be an exact loopback origin.");
  }
  return parsed.origin;
}

function parseDisposableDatabaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("The disposable identity canary database URL is invalid.");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["127.0.0.1", "localhost"].includes(parsed.hostname)
    || parsed.pathname !== `/${identityBrowserCanaryDatabaseName}`
    || parsed.search !== ""
    || parsed.hash !== ""
    || parsed.username === ""
  ) {
    throw new Error("The identity canary database must be the exact disposable local database.");
  }
  return identityBrowserCanaryDatabaseName;
}

function required(environment: Environment, name: string): string {
  const value = environment[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`The disposable identity canary requires ${name}.`);
  }
  return value;
}

function requirePrivateCredential(environment: Environment, name: string): void {
  const value = required(environment, name);
  if (Buffer.byteLength(value, "utf8") < 32 || Buffer.byteLength(value, "utf8") > 512) {
    throw new Error(`The disposable identity canary requires a strong ${name}.`);
  }
}

function optionalBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("The disposable identity canary boolean setting is invalid.");
}

function optionalInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error("The disposable identity canary timeout is invalid.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error("The disposable identity canary timeout is invalid.");
  }
  return parsed;
}
