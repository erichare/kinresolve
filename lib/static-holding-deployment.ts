import {
  staticHoldingDeploymentMetadata,
  validatePreviousDeployment,
  type DeploymentOwnershipExpectations,
  type ValidatedVercelDeployment
} from "./vercel-release-contract.ts";

export { staticHoldingDeploymentMetadata };

type JsonObject = Record<string, unknown>;

export type StaticHoldingCandidateExpectations = DeploymentOwnershipExpectations & {
  appBaseUrl: string;
};

export function validateStaticHoldingCandidateDeployment(
  document: unknown,
  expectations: StaticHoldingCandidateExpectations
): ValidatedVercelDeployment {
  const deployment = validatePreviousDeployment(document, expectations);
  if (!isObject(document)) {
    throw new Error("The Vercel deployment response must contain a JSON object.");
  }

  const metadata = document.meta;
  if (!isObject(metadata)) {
    throw new Error("The static holding deployment metadata is missing.");
  }
  for (const [name, expected] of Object.entries(staticHoldingDeploymentMetadata)) {
    if (metadata[name] !== expected) {
      throw new Error(`The static holding deployment ${name} metadata does not match the contract.`);
    }
  }

  const canonicalHostname = parseOrigin(expectations.appBaseUrl, "APP_BASE_URL").hostname;
  if (readAliases(document).includes(canonicalHostname)) {
    throw new Error("The static holding candidate must not own the canonical application alias before promotion.");
  }

  return deployment;
}

function readAliases(document: JsonObject): readonly string[] {
  const lists: string[][] = [];
  for (const key of ["aliases", "alias"] as const) {
    const value = document[key];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) {
      throw new Error("The Vercel deployment aliases must be an array.");
    }
    lists.push(value.map((alias) => {
      if (typeof alias !== "string") {
        throw new Error("Every Vercel deployment alias must be a string origin.");
      }
      return parseOrigin(alias, "A Vercel deployment alias").hostname;
    }));
  }

  if (lists.length === 0) return [];
  const normalized = lists.map((list) => [...new Set(list)].sort());
  if (normalized.length > 1 && JSON.stringify(normalized[0]) !== JSON.stringify(normalized[1])) {
    throw new Error("The Vercel response contains ambiguous deployment aliases.");
  }
  return normalized[0];
}

function parseOrigin(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch (error) {
    throw new Error(`${label} must be a valid HTTPS origin.`, { cause: error });
  }

  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.port !== ""
    || (url.pathname !== "" && url.pathname !== "/")
    || url.search !== ""
    || url.hash !== ""
  ) {
    throw new Error(`${label} must be an HTTPS origin without credentials, a port, a path, a query, or a fragment.`);
  }
  return url;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
