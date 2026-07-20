import path from "node:path";

import {
  archiveIdEnvironmentAlias,
  describeEnvironmentAliasPair,
  readArchiveIdSetting
} from "../lib/environment-aliases";
import {
  browserCanaryMutationAcknowledgement,
  resolveInsecureLoopbackProductionCanaryProfile
} from "../lib/insecure-loopback-canary";

export const syntheticMutationAcknowledgement = browserCanaryMutationAcknowledgement;
export const syntheticGedcomFixtureSha256 =
  "2dfb4b881247a58164b8fff0a309630c686366162f6dfbf8945bc7c488ca02fe";

export type BrowserCanaryMode = "disposable" | "staging" | "production";
export type BrowserCanaryDatasetMode = "empty" | "demo" | "pilot";

type Environment = Record<string, string | undefined>;

export type BrowserCanaryConfiguration = Readonly<{
  mode: BrowserCanaryMode;
  origin: string;
  appBaseUrl: string;
  releaseSha: string;
  datasetMode: BrowserCanaryDatasetMode;
  apiV1Enabled: boolean;
  observabilityProbeSecret: string;
  vercelBypassSecret?: string;
  headless: boolean;
  timeoutMs: number;
  runId: string;
  mutable: boolean;
  bootstrapOwner: boolean;
  archiveId?: string;
  userId?: string;
  email?: string;
  password?: string;
  gedcomFixturePath?: string;
}>;

export type BrowserCanaryStateConfiguration = Readonly<{
  mode: Exclude<BrowserCanaryMode, "production">;
  releaseSha: string;
  runId: string;
  archiveId: string;
  userId?: string;
  email?: string;
}>;

const fullShaPattern = /^[a-f0-9]{40}$/;
const runIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const archiveIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const userIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const probeSecretPattern = /^[A-Za-z0-9_-]{43,128}$/;
const canonicalProductionOrigin = "https://app.kinresolve.com";

export function parseBrowserCanaryMode(value: string | undefined): BrowserCanaryMode {
  if (value === "disposable" || value === "staging" || value === "production") return value;
  throw new Error("Browser canary mode must be disposable, staging, or production.");
}

export function resolveBrowserCanaryConfiguration(
  mode: BrowserCanaryMode,
  environment: Environment = process.env
): BrowserCanaryConfiguration {
  const origin = strictOrigin(environment.KINRESOLVE_CANARY_ORIGIN, "KINRESOLVE_CANARY_ORIGIN", mode);
  const appBaseUrl = strictOrigin(
    environment.KINRESOLVE_CANARY_APP_BASE_URL ?? origin,
    "KINRESOLVE_CANARY_APP_BASE_URL",
    mode
  );
  const releaseSha = required(environment.KINRESOLVE_CANARY_RELEASE_SHA, "KINRESOLVE_CANARY_RELEASE_SHA")
    .toLowerCase();
  if (!fullShaPattern.test(releaseSha)) {
    throw new Error("KINRESOLVE_CANARY_RELEASE_SHA must be one full lowercase Git SHA.");
  }

  const datasetMode = parseDatasetMode(environment.KINRESOLVE_CANARY_DATASET_MODE);
  const apiV1Enabled = strictBoolean(
    environment.KINRESOLVE_CANARY_API_V1_ENABLED,
    "KINRESOLVE_CANARY_API_V1_ENABLED"
  );
  const observabilityProbeSecret = required(
    environment.KINRESOLVE_CANARY_OBSERVABILITY_PROBE_SECRET,
    "KINRESOLVE_CANARY_OBSERVABILITY_PROBE_SECRET"
  );
  if (!probeSecretPattern.test(observabilityProbeSecret)) {
    throw new Error("KINRESOLVE_CANARY_OBSERVABILITY_PROBE_SECRET has an invalid format.");
  }

  const timeoutMs = optionalPositiveInteger(
    environment.KINRESOLVE_CANARY_TIMEOUT_MS,
    "KINRESOLVE_CANARY_TIMEOUT_MS",
    30_000,
    5_000,
    120_000
  );
  const runId = environment.KINRESOLVE_CANARY_RUN_ID?.trim() || releaseSha.slice(0, 12);
  if (!runIdPattern.test(runId)) {
    throw new Error("KINRESOLVE_CANARY_RUN_ID must be a short non-secret identifier.");
  }

  const headless = optionalStrictBoolean(environment.KINRESOLVE_CANARY_HEADLESS, true);
  const vercelBypassSecret = optionalSecret(environment.VERCEL_AUTOMATION_BYPASS_SECRET);

  if (mode === "production") {
    if (environment.KINRESOLVE_CANARY_ALLOW_MUTATION !== undefined) {
      throw new Error("Production browser smoke refuses every mutation opt-in.");
    }
    if (environment.KINRESOLVE_CANARY_MUTATION_ACKNOWLEDGEMENT !== undefined) {
      throw new Error("Production browser smoke refuses a mutation acknowledgement.");
    }
    if (environment.KINRESOLVE_CANARY_BOOTSTRAP_OWNER !== undefined) {
      throw new Error("Production browser smoke refuses owner bootstrapping.");
    }
    if (environment.KINRESOLVE_CANARY_EMAIL || environment.KINRESOLVE_CANARY_PASSWORD) {
      throw new Error("Production browser smoke refuses participant credentials.");
    }
    if (environment.KINRESOLVE_CANARY_GEDCOM_PATH) {
      throw new Error("Production browser smoke refuses a GEDCOM fixture.");
    }
    if (environment.KINRESOLVE_CANARY_ARCHIVE_ID) {
      throw new Error("Production browser smoke refuses a mutable archive identifier.");
    }
    const canonical = origin === canonicalProductionOrigin;
    if (appBaseUrl !== canonicalProductionOrigin) {
      throw new Error("Production browser smoke requires https://app.kinresolve.com as its app origin.");
    }
    if (canonical && vercelBypassSecret) {
      throw new Error("Canonical production smoke refuses a Vercel bypass credential.");
    }
    if (!canonical && (!isGeneratedVercelOrigin(origin) || !vercelBypassSecret)) {
      throw new Error("Production candidate smoke requires one generated Vercel origin and its bypass credential.");
    }
    return {
      mode,
      origin,
      appBaseUrl,
      releaseSha,
      datasetMode,
      apiV1Enabled,
      observabilityProbeSecret,
      ...(vercelBypassSecret ? { vercelBypassSecret } : {}),
      headless,
      timeoutMs,
      runId,
      mutable: false,
      bootstrapOwner: false
    };
  }

  if (
    mode === "disposable"
    && environment.NODE_ENV === "production"
    && resolveInsecureLoopbackProductionCanaryProfile(environment) !== "browser"
  ) {
    throw new Error("The disposable production browser canary requires the exact loopback safety profile.");
  }

  if (datasetMode !== "demo") {
    throw new Error("Mutable browser canaries require an isolated demo dataset.");
  }
  if (origin !== appBaseUrl) {
    throw new Error("Mutable browser canaries require the exact configured application origin.");
  }
  if (environment.KINRESOLVE_CANARY_ALLOW_MUTATION !== "true") {
    throw new Error("Mutable browser canaries require KINRESOLVE_CANARY_ALLOW_MUTATION=true.");
  }
  if (environment.KINRESOLVE_CANARY_MUTATION_ACKNOWLEDGEMENT !== syntheticMutationAcknowledgement) {
    throw new Error("Mutable browser canaries require the exact synthetic-cell acknowledgement.");
  }
  const email = required(environment.KINRESOLVE_CANARY_EMAIL, "KINRESOLVE_CANARY_EMAIL");
  const password = required(environment.KINRESOLVE_CANARY_PASSWORD, "KINRESOLVE_CANARY_PASSWORD");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("KINRESOLVE_CANARY_EMAIL must be an email address.");
  }
  if (password.length < 10 || password.length > 256) {
    throw new Error("KINRESOLVE_CANARY_PASSWORD must be between 10 and 256 characters.");
  }
  const bootstrapOwner = optionalStrictBoolean(environment.KINRESOLVE_CANARY_BOOTSTRAP_OWNER, false);
  if (mode === "staging" && bootstrapOwner) {
    throw new Error("Hosted staging must use a pre-provisioned invited identity.");
  }
  if (vercelBypassSecret) {
    throw new Error("Mutable browser canaries refuse Vercel bypass credentials.");
  }

  if (environment.KINRESOLVE_CANARY_GEDCOM_PATH !== undefined) {
    throw new Error("Mutable browser canaries use only the repository-owned synthetic GEDCOM fixture.");
  }
  const archiveId = required(environment.KINRESOLVE_CANARY_ARCHIVE_ID, "KINRESOLVE_CANARY_ARCHIVE_ID");
  if (!archiveIdPattern.test(archiveId)) {
    throw new Error("KINRESOLVE_CANARY_ARCHIVE_ID has an invalid format.");
  }
  const runtimeArchiveId = required(
    readArchiveIdSetting(environment),
    describeEnvironmentAliasPair(archiveIdEnvironmentAlias)
  );
  if (runtimeArchiveId !== archiveId) {
    throw new Error(
      "KINRESOLVE_CANARY_ARCHIVE_ID must exactly match the runtime "
      + `${describeEnvironmentAliasPair(archiveIdEnvironmentAlias)} setting.`
    );
  }
  const userId = environment.KINRESOLVE_CANARY_USER_ID?.trim();
  if (userId && !userIdPattern.test(userId)) {
    throw new Error("KINRESOLVE_CANARY_USER_ID has an invalid format.");
  }
  if (mode === "staging" && !userId) {
    throw new Error("Hosted staging requires the exact invited canary user ID.");
  }
  const gedcomFixturePath = path.resolve(process.cwd(), "tests", "fixtures", "browser-canary.ged");
  return {
    mode,
    origin,
    appBaseUrl,
    releaseSha,
    datasetMode,
    apiV1Enabled,
    observabilityProbeSecret,
    ...(vercelBypassSecret ? { vercelBypassSecret } : {}),
    headless,
    timeoutMs,
    runId,
    mutable: true,
    bootstrapOwner,
    archiveId,
    ...(userId ? { userId } : {}),
    email,
    password,
    gedcomFixturePath
  };
}

export function resolveBrowserCanaryStateConfiguration(
  mode: BrowserCanaryMode,
  environment: Environment = process.env
): BrowserCanaryStateConfiguration {
  if (mode === "production") {
    throw new Error("Production browser smoke has no mutable state guard.");
  }
  const releaseSha = required(environment.KINRESOLVE_CANARY_RELEASE_SHA, "KINRESOLVE_CANARY_RELEASE_SHA")
    .toLowerCase();
  if (!fullShaPattern.test(releaseSha)) {
    throw new Error("KINRESOLVE_CANARY_RELEASE_SHA must be one full lowercase Git SHA.");
  }
  if (parseDatasetMode(environment.KINRESOLVE_CANARY_DATASET_MODE) !== "demo") {
    throw new Error("Mutable browser canary state requires an isolated demo dataset.");
  }
  if (environment.KINRESOLVE_CANARY_ALLOW_MUTATION !== "true") {
    throw new Error("Mutable browser canary state requires KINRESOLVE_CANARY_ALLOW_MUTATION=true.");
  }
  if (environment.KINRESOLVE_CANARY_MUTATION_ACKNOWLEDGEMENT !== syntheticMutationAcknowledgement) {
    throw new Error("Mutable browser canary state requires the exact synthetic-cell acknowledgement.");
  }
  const runId = environment.KINRESOLVE_CANARY_RUN_ID?.trim() || releaseSha.slice(0, 12);
  if (!runIdPattern.test(runId)) {
    throw new Error("KINRESOLVE_CANARY_RUN_ID must be a short non-secret identifier.");
  }
  const archiveId = required(environment.KINRESOLVE_CANARY_ARCHIVE_ID, "KINRESOLVE_CANARY_ARCHIVE_ID");
  if (!archiveIdPattern.test(archiveId)) {
    throw new Error("KINRESOLVE_CANARY_ARCHIVE_ID has an invalid format.");
  }
  const runtimeArchiveId = required(
    readArchiveIdSetting(environment),
    describeEnvironmentAliasPair(archiveIdEnvironmentAlias)
  );
  if (runtimeArchiveId !== archiveId) {
    throw new Error(
      "KINRESOLVE_CANARY_ARCHIVE_ID must exactly match the runtime "
      + `${describeEnvironmentAliasPair(archiveIdEnvironmentAlias)} setting.`
    );
  }
  if (mode === "staging") {
    const userId = required(environment.KINRESOLVE_CANARY_USER_ID, "KINRESOLVE_CANARY_USER_ID");
    if (!userIdPattern.test(userId)) {
      throw new Error("KINRESOLVE_CANARY_USER_ID has an invalid format.");
    }
    return { mode, releaseSha, runId, archiveId, userId };
  }
  const email = required(environment.KINRESOLVE_CANARY_EMAIL, "KINRESOLVE_CANARY_EMAIL");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("KINRESOLVE_CANARY_EMAIL must be an email address.");
  }
  return { mode, releaseSha, runId, archiveId, email };
}

export function browserCanaryCaseTitle(
  config: Pick<BrowserCanaryConfiguration, "releaseSha" | "runId">
): string {
  return `Synthetic browser canary ${config.releaseSha.slice(0, 12)} ${config.runId}`;
}

export function browserCanarySourceName(
  config: Pick<BrowserCanaryConfiguration, "releaseSha" | "runId">
): string {
  return `Synthetic GEDCOM canary ${config.releaseSha.slice(0, 12)} ${config.runId}`;
}

function strictOrigin(value: string | undefined, name: string, mode: BrowserCanaryMode): string {
  const raw = required(value, name);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be one absolute origin.`);
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (
    url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
    || (url.protocol !== "https:" && !(mode === "disposable" && loopback && url.protocol === "http:"))
  ) {
    throw new Error(`${name} must be one ${mode === "disposable" ? "HTTPS or loopback HTTP" : "HTTPS"} origin.`);
  }
  return url.origin;
}

function isGeneratedVercelOrigin(origin: string): boolean {
  const url = new URL(origin);
  return url.protocol === "https:"
    && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/.test(url.hostname);
}

function parseDatasetMode(value: string | undefined): BrowserCanaryDatasetMode {
  if (value === "empty" || value === "demo" || value === "pilot") return value;
  throw new Error("KINRESOLVE_CANARY_DATASET_MODE must be empty, demo, or pilot.");
}

function strictBoolean(value: string | undefined, name: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be exactly true or false.`);
}

function optionalStrictBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Optional browser canary booleans must be exactly true or false.");
}

function optionalPositiveInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${name} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function optionalSecret(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(normalized)) {
    throw new Error("VERCEL_AUTOMATION_BYPASS_SECRET has an invalid format.");
  }
  return normalized;
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}
