type Environment = Record<string, string | undefined>;

export const browserCanaryMutationAcknowledgement =
  "I acknowledge this browser canary may mutate only an isolated synthetic demo cell.";
export const identityCanaryMutationAcknowledgement =
  "I understand this identity canary creates append-only invitation, audit, and API-token evidence only in a disposable local database that is destroyed with the CI job.";
export const insecureLoopbackCanaryOriginAcknowledgement =
  "I acknowledge insecure HTTP is permitted only for this disposable loopback production canary.";

export type InsecureLoopbackCanaryProfile = "browser" | "identity";

const fullShaPattern = /^[a-f0-9]{40}$/;
export function resolveInsecureLoopbackProductionCanaryProfile(
  environment: Environment
): InsecureLoopbackCanaryProfile | null {
  if (
    environment.NODE_ENV !== "production"
    || environment.KINRESOLVE_INSECURE_LOOPBACK_CANARY_ORIGIN !== "true"
    || environment.KINRESOLVE_INSECURE_LOOPBACK_CANARY_ACKNOWLEDGEMENT
      !== insecureLoopbackCanaryOriginAcknowledgement
    || environment.DATABASE_AUTO_MIGRATE !== "false"
    || environment.KINRESOLVE_DATASET_MODE !== "demo"
    || hasVercelRuntimeMarker(environment)
  ) return null;

  const releaseSha = environment.KINRESOLVE_CANARY_RELEASE_SHA;
  if (!releaseSha
    || !fullShaPattern.test(releaseSha)
    || environment.KINRESOLVE_BUILD_COMMIT_SHA !== releaseSha) return null;

  const browserProfile = environment.KINRESOLVE_CANARY_ALLOW_MUTATION === "true";
  const identityProfile = environment.KINRESOLVE_IDENTITY_CANARY_ALLOW_MUTATION === "true";
  if (browserProfile === identityProfile) return null;

  const profile: InsecureLoopbackCanaryProfile = browserProfile ? "browser" : "identity";
  const canaryOrigin = profile === "browser"
    ? environment.KINRESOLVE_CANARY_ORIGIN
    : environment.KINRESOLVE_IDENTITY_CANARY_ORIGIN;
  const appOrigin = exactLoopbackOrigin(environment.APP_BASE_URL);
  if (!appOrigin || canaryOrigin !== appOrigin) return null;

  const databaseUrl = exactLoopbackDatabaseUrl(
    environment.DATABASE_URL,
    profile === "browser" ? "kinresolve_browser_canary" : "kinresolve_identity_canary"
  );
  if (!databaseUrl) return null;

  if (profile === "identity") {
    return environment.KINRESOLVE_IDENTITY_CANARY_MUTATION_ACKNOWLEDGEMENT
        === identityCanaryMutationAcknowledgement
      && environment.KINRESOLVE_IDENTITY_CANARY_ORIGIN === appOrigin
      && environment.KINSLEUTH_ARCHIVE_ID === "archive-identity-canary"
      ? profile
      : null;
  }

  if (
    environment.KINRESOLVE_CANARY_MUTATION_ACKNOWLEDGEMENT
      !== browserCanaryMutationAcknowledgement
    || environment.KINRESOLVE_CANARY_APP_BASE_URL !== appOrigin
    || environment.KINRESOLVE_CANARY_DATASET_MODE !== "demo"
    || environment.KINRESOLVE_CANARY_ARCHIVE_ID !== "archive-browser-canary"
    || environment.KINSLEUTH_ARCHIVE_ID !== "archive-browser-canary"
    || environment.KINRESOLVE_CANARY_OPERATOR_DATABASE_URL !== databaseUrl
    || environment.KINRESOLVE_DEPLOYMENT_MODE !== "self-hosted"
    || environment.KINRESOLVE_OBJECT_STORAGE_BACKEND !== "s3"
  ) return null;

  const storageEndpoint = exactLoopbackOrigin(environment.S3_ENDPOINT);
  return storageEndpoint
    && environment.S3_PUBLIC_ENDPOINT === storageEndpoint
    ? profile
    : null;
}

function hasVercelRuntimeMarker(environment: Environment): boolean {
  return Object.keys(environment).some((name) => /^VERCEL(?:_|$)/.test(name));
}

function exactLoopbackOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const port = Number(parsed.port);
    return parsed.protocol === "http:"
      && parsed.hostname === "127.0.0.1"
      && Number.isInteger(port)
      && port >= 1024
      && port <= 65_535
      && parsed.username === ""
      && parsed.password === ""
      && parsed.pathname === "/"
      && parsed.search === ""
      && parsed.hash === ""
      && value === parsed.origin
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

function exactLoopbackDatabaseUrl(
  value: string | undefined,
  databaseName: string
): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const port = Number(parsed.port);
    return ["postgres:", "postgresql:"].includes(parsed.protocol)
      && parsed.hostname === "127.0.0.1"
      && Number.isInteger(port)
      && port >= 1024
      && port <= 65_535
      && parsed.username !== ""
      && parsed.password !== ""
      && parsed.pathname === `/${databaseName}`
      && parsed.search === ""
      && parsed.hash === ""
      ? value
      : null;
  } catch {
    return null;
  }
}
