import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { loadApprovedBetaLegalManifest } from "./beta-legal-manifest.ts";
import {
  allowSignupsEnvironmentAlias,
  archiveIdEnvironmentAlias,
  describeEnvironmentAliasPair,
  environmentAliasPairs,
  readAliasedEnvironmentSetting
} from "./environment-aliases.ts";
import { requiredReadableProductionEnvironmentNames } from "./vercel-environment-contract.ts";
import { databaseIdentityPattern } from "./database-attestation.ts";
import { validateOperatorPublicKeyConfiguration } from "./operator-signature.ts";

const requiredProductionSettings = requiredReadableProductionEnvironmentNames;

export type ReleaseContractInput = {
  releaseTag: string;
  packageVersion: string;
  releaseCommit: string;
  checkedOutCommit: string;
  releaseIsOnMain: boolean;
  project: {
    projectId?: unknown;
    orgId?: unknown;
    settings?: {
      framework?: unknown;
    };
  };
  expectedProjectId: string;
  expectedOrgId: string;
  expectedAppBaseUrl?: string;
  expectedDatasetMode?: "empty" | "demo" | "pilot";
  expectedScheduledWritesEnabled?: boolean;
  expectedApiV1Enabled?: boolean;
  expectedBetaApplicationsEnabled?: boolean;
  expectedArchiveId?: string;
  forbiddenProjectId?: string;
  forbiddenAppBaseUrl?: string;
  productionEnvironment: Record<string, string | undefined>;
};

type ReleaseContractResult = {
  version: string;
  appOrigin: string;
  datasetMode: "empty" | "demo" | "pilot";
  archiveId: string;
  databaseIdentity: string;
  objectStorageIdentity: string;
  scheduledWritesEnabled: boolean;
  apiV1Enabled: boolean;
  betaApplicationsEnabled: boolean;
};

type LoadReleaseContractOptions = {
  repositoryRoot: string;
};

type LoginRedirectInput = {
  deploymentUrl: string;
  appBaseUrl: string;
  location: string;
};

function parseUrl(value: string, variableName: string): URL {
  try {
    return new URL(value);
  } catch (error) {
    throw new Error(`${variableName} must be a valid URL.`, { cause: error });
  }
}

function validateHttpsOrigin(value: string, variableName: string): URL {
  const url = parseUrl(value, variableName);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`${variableName} must be an HTTPS origin without credentials, a path, a query, or a fragment.`);
  }
  return url;
}

export function validateReleaseContract(input: ReleaseContractInput): ReleaseContractResult {
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(input.packageVersion)) {
    throw new Error("package.json version must be a stable semantic version.");
  }
  if (!/^[0-9a-f]{40}$/.test(input.releaseCommit)) {
    throw new Error("The release commit must be a 40-character lowercase SHA.");
  }
  if (!/^[0-9a-f]{40}$/.test(input.checkedOutCommit)) {
    throw new Error("The checked-out commit must be a 40-character lowercase SHA.");
  }
  const expectedTag = `v${input.packageVersion}`;
  if (input.releaseTag !== expectedTag) {
    throw new Error(`Release tag must match package version ${input.packageVersion}.`);
  }
  if (input.releaseCommit !== input.checkedOutCommit) {
    throw new Error("The requested release commit must equal the checked-out revision.");
  }
  if (!input.releaseIsOnMain) {
    throw new Error("The requested release revision must be an ancestor of origin/main.");
  }
  if (!input.expectedProjectId || input.project.projectId !== input.expectedProjectId) {
    throw new Error("The linked project ID must match the expected Vercel project.");
  }
  if (input.forbiddenProjectId && input.project.projectId === input.forbiddenProjectId) {
    throw new Error("The linked Vercel project must be isolated from the forbidden release cell.");
  }
  if (!input.expectedOrgId || input.project.orgId !== input.expectedOrgId) {
    throw new Error("The linked organization ID must match the expected Vercel organization.");
  }
  if (input.project.settings?.framework !== "nextjs") {
    throw new Error("The linked Vercel project framework must be nextjs.");
  }

  const missing = [
    ...requiredProductionSettings.filter((name) => !input.productionEnvironment[name]?.trim()),
    ...environmentAliasPairs
      .filter((pair) => !readAliasedEnvironmentSetting(pair, input.productionEnvironment)?.trim())
      .map((pair) => describeEnvironmentAliasPair(pair))
  ];
  if (missing.length > 0) {
    throw new Error(`Missing required production settings: ${missing.join(", ")}.`);
  }

  const environment = Object.fromEntries(
    requiredProductionSettings.map((name) => [name, input.productionEnvironment[name]!])
  ) as Record<(typeof requiredProductionSettings)[number], string>;
  if (!/^[1-9]\d*$/.test(environment.DATABASE_POOL_MAX) || Number(environment.DATABASE_POOL_MAX) > 100) {
    throw new Error("DATABASE_POOL_MAX must be a positive integer no greater than 100.");
  }
  if (environment.DATABASE_AUTO_MIGRATE !== "false") {
    throw new Error("DATABASE_AUTO_MIGRATE must be exactly false for production releases.");
  }
  if (environment.KINRESOLVE_DEPLOYMENT_MODE !== "hosted") {
    throw new Error("KINRESOLVE_DEPLOYMENT_MODE must be exactly hosted for production releases.");
  }
  if (environment.KINRESOLVE_OBJECT_STORAGE_BACKEND !== "vercel-blob") {
    throw new Error("KINRESOLVE_OBJECT_STORAGE_BACKEND must be exactly vercel-blob for production releases.");
  }
  const allowSignups = readAliasedEnvironmentSetting(allowSignupsEnvironmentAlias, input.productionEnvironment);
  if (allowSignups !== "false") {
    throw new Error(
      `${describeEnvironmentAliasPair(allowSignupsEnvironmentAlias)} must be exactly false for production releases.`
    );
  }
  if (environment.KINRESOLVE_TRANSACTIONAL_EMAIL_PROVIDER !== "resend") {
    throw new Error("KINRESOLVE_TRANSACTIONAL_EMAIL_PROVIDER must be exactly resend for production releases.");
  }
  if (environment.KINRESOLVE_TRANSACTIONAL_EMAIL_FROM !== "Kin Resolve <beta@kinresolve.com>") {
    throw new Error("KINRESOLVE_TRANSACTIONAL_EMAIL_FROM must be the approved beta@kinresolve.com sender.");
  }
  if (environment.KINRESOLVE_TRANSACTIONAL_EMAIL_REPLY_TO !== "beta@kinresolve.com") {
    throw new Error("KINRESOLVE_TRANSACTIONAL_EMAIL_REPLY_TO must be exactly beta@kinresolve.com.");
  }
  if (environment.AI_BASE_URL !== "https://api.openai.com/v1") {
    throw new Error("AI_BASE_URL must be exactly https://api.openai.com/v1 for the private pilot.");
  }
  if (environment.AI_API_MODE !== "responses") {
    throw new Error("AI_API_MODE must be exactly responses for the private pilot.");
  }
  if (environment.AI_CHAT_MODEL !== "gpt-5-mini") {
    throw new Error("AI_CHAT_MODEL must be exactly gpt-5-mini for the private pilot.");
  }
  try {
    validateOperatorPublicKeyConfiguration({
      audience: environment.KINRESOLVE_BETA_OPERATOR_AUDIENCE,
      keyId: environment.KINRESOLVE_BETA_OPERATOR_KEY_ID,
      publicKeySpkiBase64Url: environment.KINRESOLVE_BETA_OPERATOR_PUBLIC_KEY_SPKI
    });
  } catch (error) {
    throw new Error("The beta operator public-key configuration is invalid.", { cause: error });
  }
  try {
    const legal = loadApprovedBetaLegalManifest(environment);
    for (const document of [legal.participationTerms, legal.privacyNotice, legal.betaBoundary]) {
      if (new URL(document.url).origin !== "https://kinresolve.com") {
        throw new Error("wrong legal origin");
      }
    }
  } catch (error) {
    throw new Error("The approved private-beta legal document contract is invalid.", { cause: error });
  }
  if (!["empty", "demo", "pilot"].includes(environment.KINRESOLVE_DATASET_MODE)) {
    throw new Error("KINRESOLVE_DATASET_MODE must be empty, demo, or pilot.");
  }
  const datasetMode = environment.KINRESOLVE_DATASET_MODE as ReleaseContractResult["datasetMode"];
  if (input.expectedDatasetMode !== undefined && datasetMode !== input.expectedDatasetMode) {
    throw new Error("KINRESOLVE_DATASET_MODE must match the expected release cell dataset mode.");
  }
  const archiveId = readAliasedEnvironmentSetting(archiveIdEnvironmentAlias, input.productionEnvironment) ?? "";
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(archiveId)) {
    throw new Error(
      `${describeEnvironmentAliasPair(archiveIdEnvironmentAlias)} `
      + "must be a safe lowercase archive identifier of at most 63 characters."
    );
  }
  if (input.expectedArchiveId !== undefined && archiveId !== input.expectedArchiveId) {
    throw new Error(
      `${describeEnvironmentAliasPair(archiveIdEnvironmentAlias)} must match the expected release cell archive.`
    );
  }
  if (environment.KINRESOLVE_GUIDED_RESEARCH_ENABLED !== "true") {
    throw new Error("KINRESOLVE_GUIDED_RESEARCH_ENABLED must be exactly true for the private beta release.");
  }
  if (environment.KINRESOLVE_EXPORT_REFRESH_ENABLED !== "true") {
    throw new Error("KINRESOLVE_EXPORT_REFRESH_ENABLED must be exactly true for the private beta release.");
  }
  if (
    environment.KINRESOLVE_BETA_APPLICATIONS_ENABLED !== "true"
    && environment.KINRESOLVE_BETA_APPLICATIONS_ENABLED !== "false"
  ) {
    throw new Error("KINRESOLVE_BETA_APPLICATIONS_ENABLED must be exactly true or false.");
  }
  const betaApplicationsEnabled = environment.KINRESOLVE_BETA_APPLICATIONS_ENABLED === "true";
  const expectedBetaApplicationsEnabled = input.expectedBetaApplicationsEnabled ?? false;
  if (betaApplicationsEnabled !== expectedBetaApplicationsEnabled) {
    throw new Error(
      `KINRESOLVE_BETA_APPLICATIONS_ENABLED must be exactly ${String(expectedBetaApplicationsEnabled)} for this release.`
    );
  }
  if (environment.KINRESOLVE_API_V1_ENABLED !== "true" && environment.KINRESOLVE_API_V1_ENABLED !== "false") {
    throw new Error("KINRESOLVE_API_V1_ENABLED must be exactly true or false.");
  }
  const apiV1Enabled = environment.KINRESOLVE_API_V1_ENABLED === "true";
  const expectedApiV1Enabled = input.expectedApiV1Enabled ?? false;
  if (apiV1Enabled !== expectedApiV1Enabled) {
    throw new Error(
      `KINRESOLVE_API_V1_ENABLED must be exactly ${String(expectedApiV1Enabled)} for this release mode.`
    );
  }
  if (
    environment.KINRESOLVE_SCHEDULED_WRITES_ENABLED !== "true"
    && environment.KINRESOLVE_SCHEDULED_WRITES_ENABLED !== "false"
  ) {
    throw new Error("KINRESOLVE_SCHEDULED_WRITES_ENABLED must be exactly true or false.");
  }
  const scheduledWritesEnabled = environment.KINRESOLVE_SCHEDULED_WRITES_ENABLED === "true";
  const expectedScheduledWritesEnabled = input.expectedScheduledWritesEnabled ?? true;
  if (scheduledWritesEnabled !== expectedScheduledWritesEnabled) {
    throw new Error(
      `KINRESOLVE_SCHEDULED_WRITES_ENABLED must be exactly ${String(expectedScheduledWritesEnabled)} for this release cell.`
    );
  }
  if (!databaseIdentityPattern.test(environment.KINRESOLVE_DATABASE_IDENTITY)) {
    throw new Error("KINRESOLVE_DATABASE_IDENTITY must be a lowercase SHA-256 database fingerprint.");
  }
  if (!databaseIdentityPattern.test(environment.KINRESOLVE_OBJECT_STORAGE_IDENTITY)) {
    throw new Error("KINRESOLVE_OBJECT_STORAGE_IDENTITY must be a lowercase SHA-256 storage fingerprint.");
  }
  const cohortOneCapabilities = {
    KINRESOLVE_DNA_ENABLED: "false",
    KINRESOLVE_EXTERNAL_AI_ENABLED: "true",
    KINRESOLVE_PUBLIC_ARCHIVE_ENABLED: "false",
    KINRESOLVE_PUBLIC_PUBLISHING_ENABLED: "false",
    KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED: "false",
    KINRESOLVE_PACKAGE_MEDIA_ENABLED: "false",
    KINRESOLVE_PLAIN_GEDCOM_ENABLED: "true"
  } as const;
  for (const [name, expected] of Object.entries(cohortOneCapabilities)) {
    if (environment[name as keyof typeof environment] !== expected) {
      throw new Error(`${name} must be exactly ${expected} for the cohort-one production release.`);
    }
  }

  const appUrl = validateHttpsOrigin(environment.APP_BASE_URL, "APP_BASE_URL");
  if (input.expectedAppBaseUrl !== undefined) {
    const expectedAppUrl = validateHttpsOrigin(input.expectedAppBaseUrl, "Expected APP_BASE_URL");
    if (appUrl.origin !== expectedAppUrl.origin) {
      throw new Error("APP_BASE_URL must match the expected canonical origin.");
    }
  }
  if (input.forbiddenAppBaseUrl !== undefined) {
    const forbiddenAppUrl = validateHttpsOrigin(input.forbiddenAppBaseUrl, "Forbidden APP_BASE_URL");
    if (appUrl.origin === forbiddenAppUrl.origin) {
      throw new Error("APP_BASE_URL must be isolated from the forbidden release cell origin.");
    }
  }
  if (environment.KINRESOLVE_BETA_OPERATOR_AUDIENCE !== appUrl.origin) {
    throw new Error("KINRESOLVE_BETA_OPERATOR_AUDIENCE must exactly match the canonical APP_BASE_URL origin.");
  }

  return {
    version: input.packageVersion,
    appOrigin: appUrl.origin,
    datasetMode,
    archiveId,
    databaseIdentity: environment.KINRESOLVE_DATABASE_IDENTITY,
    objectStorageIdentity: environment.KINRESOLVE_OBJECT_STORAGE_IDENTITY,
    scheduledWritesEnabled,
    apiV1Enabled,
    betaApplicationsEnabled
  };
}

async function readRequiredFile(filePath: string, missingMessage: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(missingMessage, { cause: error });
    }
    throw error;
  }
}

function parseJsonObject(contents: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`, { cause: error });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function findClosingQuote(value: string, quote: "'" | '"', start: number): number {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] !== quote) continue;
    let backslashes = 0;
    for (let previous = index - 1; previous >= 0 && value[previous] === "\\"; previous -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) return index;
  }
  return -1;
}

function validateEnvironmentFileShape(contents: string): void {
  const names = new Set<string>();
  let activeQuote: "'" | '"' | undefined;

  for (const line of contents.split(/\r?\n/)) {
    if (activeQuote) {
      const closing = findClosingQuote(line, activeQuote, 0);
      if (closing === -1) continue;
      if (!/^\s*(?:#.*)?$/.test(line.slice(closing + 1))) {
        throw new Error("The pulled Vercel production environment file could not be parsed.");
      }
      activeQuote = undefined;
      continue;
    }

    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const assignment = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!assignment) {
      throw new Error("The pulled Vercel production environment file could not be parsed.");
    }
    const [, name, rawValue] = assignment;
    if (names.has(name)) {
      throw new Error(`The pulled Vercel production environment file contains duplicate ${name} assignments.`);
    }
    names.add(name);

    const value = rawValue.trimStart();
    const quote = value[0];
    if (quote !== "'" && quote !== '"') continue;
    const closing = findClosingQuote(value, quote, 1);
    if (closing === -1) {
      activeQuote = quote;
    } else if (!/^\s*(?:#.*)?$/.test(value.slice(closing + 1))) {
      throw new Error("The pulled Vercel production environment file could not be parsed.");
    }
  }

  if (activeQuote) {
    throw new Error("The pulled Vercel production environment file could not be parsed.");
  }
}

export async function loadReleaseContractFiles(options: LoadReleaseContractOptions): Promise<
  Pick<ReleaseContractInput, "packageVersion" | "project" | "productionEnvironment">
> {
  const environmentPath = path.join(options.repositoryRoot, ".vercel", ".env.production.local");
  const projectPath = path.join(options.repositoryRoot, ".vercel", "project.json");
  const packagePath = path.join(options.repositoryRoot, "package.json");

  const environmentContents = await readRequiredFile(
    environmentPath,
    "The pulled Vercel production environment file is missing. Run `vercel pull --environment=production` first."
  );
  let productionEnvironment: Record<string, string | undefined>;
  validateEnvironmentFileShape(environmentContents);
  try {
    productionEnvironment = parseEnv(environmentContents);
  } catch (error) {
    throw new Error("The pulled Vercel production environment file could not be parsed.", { cause: error });
  }

  const project = parseJsonObject(
    await readRequiredFile(projectPath, "The linked Vercel project file is missing."),
    "The linked Vercel project file"
  ) as ReleaseContractInput["project"];
  const packageFile = parseJsonObject(
    await readRequiredFile(packagePath, "package.json is missing."),
    "package.json"
  );
  if (typeof packageFile.version !== "string" || packageFile.version.trim() === "") {
    throw new Error("package.json must contain a nonempty version string.");
  }

  return { packageVersion: packageFile.version, project, productionEnvironment };
}

export function validateLoginRedirect(input: LoginRedirectInput): void {
  const deploymentOrigin = validateHttpsOrigin(input.deploymentUrl, "Deployment URL").origin;
  const appOrigin = validateHttpsOrigin(input.appBaseUrl, "APP_BASE_URL").origin;
  const location = parseUrl(new URL(input.location, deploymentOrigin).toString(), "Login redirect");
  if (location.origin !== appOrigin) {
    throw new Error("The login redirect must use the configured APP_BASE_URL origin.");
  }
  if (
    location.username !== "" ||
    location.password !== "" ||
    location.pathname !== "/login" ||
    location.hash !== "" ||
    location.searchParams.size !== 1 ||
    location.searchParams.get("next") !== "/app"
  ) {
    throw new Error("The deployed /app route must redirect exactly /login?next=/app.");
  }
}
