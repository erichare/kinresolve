import { resolveInsecureLoopbackProductionCanaryProfile } from "./insecure-loopback-canary";

type Environment = Record<string, string | undefined>;

export type SameOriginRequestEvaluation = "allowed" | "forbidden" | "misconfigured";

export function evaluateSameOriginRequest(
  request: Pick<Request, "headers" | "url">,
  environment: Environment = process.env
): SameOriginRequestEvaluation {
  const expectedOrigin = resolveExpectedOrigin(request.url, environment);
  if (!expectedOrigin) return "misconfigured";

  return request.headers.get("origin") === expectedOrigin
    && request.headers.get("sec-fetch-site") === "same-origin"
    ? "allowed"
    : "forbidden";
}

function resolveExpectedOrigin(requestUrl: string, environment: Environment): string | null {
  const configuredBaseUrl = environment.APP_BASE_URL;
  if (configuredBaseUrl) {
    return parseCanonicalOrigin(
      configuredBaseUrl,
      environment.NODE_ENV === "production",
      environment
    );
  }

  if (environment.NODE_ENV === "production") return null;

  try {
    return new URL(requestUrl).origin;
  } catch {
    return null;
  }
}

function parseCanonicalOrigin(
  value: string,
  requireHttps: boolean,
  environment: Environment
): string | null {
  try {
    const url = new URL(value);
    const protocolAllowed = requireHttps
      ? url.protocol === "https:"
        || resolveInsecureLoopbackProductionCanaryProfile(environment) !== null
      : url.protocol === "https:" || url.protocol === "http:";

    if (
      !protocolAllowed
      || url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}
