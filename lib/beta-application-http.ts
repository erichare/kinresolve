import { NextResponse } from "next/server";

import { clientAddressRateLimitSubject } from "./auth-rate-limit-subject";
import {
  betaApplicationMarketingOrigin,
  betaApplicationRuntimeConfiguration,
  betaApplicationThanksUrl,
  normalizeBetaApplication,
  submitBetaApplication,
  type BetaApplicationEnvironment,
  type BetaApplicationServiceOptions,
  type NormalizedBetaApplication
} from "./beta-applications";
import {
  consumeDurableAuthRateLimit,
  type ConsumeDurableAuthRateLimitInput,
  type DurableAuthRateLimitResult
} from "./durable-auth-rate-limit";

export const betaApplicationMaximumBodyBytes = 16 * 1024;

const allowedFields = new Set([
  "archive_size_band",
  "consent",
  "consent_version",
  "current_tool",
  "email",
  "name",
  "researcher_type",
  "website",
  "workflow"
]);

type Consume = (input: ConsumeDurableAuthRateLimitInput) => Promise<DurableAuthRateLimitResult>;
type Submit = (
  application: NormalizedBetaApplication,
  options: BetaApplicationServiceOptions
) => Promise<Readonly<{ applicationId: string; duplicate: boolean }>>;

export type BetaApplicationHttpDependencies = Readonly<{
  consume?: Consume;
  environment?: BetaApplicationEnvironment;
  serviceOptions?: Omit<BetaApplicationServiceOptions, "environment">;
  submit?: Submit;
}>;

export class BetaApplicationRequestError extends Error {
  constructor(readonly status: 400 | 413 | 415) {
    super("The beta application request is invalid.");
    this.name = "BetaApplicationRequestError";
  }
}

export function evaluateBetaApplicationNativeFormRequest(
  request: Pick<Request, "headers">
): boolean {
  return request.headers.get("origin") === betaApplicationMarketingOrigin
    && request.headers.get("authorization") === null
    && request.headers.get("cookie") === null;
}

export async function handleBetaApplicationPost(
  request: Request,
  dependencies: BetaApplicationHttpDependencies = {}
): Promise<NextResponse> {
  const environment = dependencies.environment ?? process.env;
  let configuration: ReturnType<typeof betaApplicationRuntimeConfiguration>;
  try {
    configuration = betaApplicationRuntimeConfiguration(environment);
  } catch {
    return safeResponse(503);
  }
  if (!configuration.enabled || !configuration.hmacSecret) return safeResponse(404);
  if (!evaluateBetaApplicationNativeFormRequest(request)) return safeResponse(403);

  let parameters: URLSearchParams;
  try {
    parameters = await readBetaApplicationForm(request);
  } catch (error) {
    if (error instanceof BetaApplicationRequestError) return safeResponse(error.status);
    return safeResponse(400);
  }

  // The honeypot receives the same navigation result as a real success while
  // performing no database, rate-limit, or provider work.
  if ((parameters.get("website") ?? "").trim() !== "") return successRedirect();

  let application: NormalizedBetaApplication;
  try {
    if (parameters.get("consent") !== "accepted") throw new Error("consent absent");
    application = normalizeBetaApplication({
      archiveSizeBand: requiredField(parameters, "archive_size_band"),
      consentVersion: requiredField(parameters, "consent_version"),
      currentTool: parameters.get("current_tool"),
      email: requiredField(parameters, "email"),
      name: requiredField(parameters, "name"),
      researcherType: requiredField(parameters, "researcher_type"),
      workflow: requiredField(parameters, "workflow")
    });
  } catch {
    return safeResponse(400);
  }

  const consume = dependencies.consume ?? ((input) => consumeDurableAuthRateLimit(input));
  try {
    const network = await consume({
      hmacSecret: configuration.hmacSecret,
      maximumRequests: 20,
      scope: "beta-application:network",
      subject: clientAddressRateLimitSubject(request, environment),
      windowSeconds: 60 * 60
    });
    if (!network.allowed) return rateLimitedResponse(network.retryAfterSeconds);
    const email = await consume({
      hmacSecret: configuration.hmacSecret,
      maximumRequests: 5,
      scope: "beta-application:email",
      subject: `email:${application.email}`,
      windowSeconds: 24 * 60 * 60
    });
    if (!email.allowed) return rateLimitedResponse(email.retryAfterSeconds);
  } catch {
    return safeResponse(503);
  }

  try {
    const submit = dependencies.submit ?? submitBetaApplication;
    await submit(application, {
      ...(dependencies.serviceOptions ?? {}),
      environment
    });
    return successRedirect();
  } catch {
    return safeResponse(503);
  }
}

export async function readBetaApplicationForm(request: Request): Promise<URLSearchParams> {
  validateContentType(request.headers.get("content-type"));
  const contentEncoding = request.headers.get("content-encoding");
  if (contentEncoding !== null && contentEncoding.trim().toLowerCase() !== "identity") {
    throw new BetaApplicationRequestError(415);
  }
  const declaredLength = request.headers.get("content-length");
  let declaredByteLength: number | null = null;
  if (declaredLength !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(declaredLength)) {
      throw new BetaApplicationRequestError(400);
    }
    if (BigInt(declaredLength) > BigInt(betaApplicationMaximumBodyBytes)) {
      throw new BetaApplicationRequestError(413);
    }
    declaredByteLength = Number(declaredLength);
  }
  if (!request.body) throw new BetaApplicationRequestError(400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > betaApplicationMaximumBodyBytes) {
        void reader.cancel().catch(() => undefined);
        throw new BetaApplicationRequestError(413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (declaredByteLength !== null && declaredByteLength !== total) {
    throw new BetaApplicationRequestError(400);
  }
  if (total === 0) throw new BetaApplicationRequestError(400);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let body: string;
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    validatePercentEncoding(body);
  } catch {
    throw new BetaApplicationRequestError(400);
  }
  const parameters = new URLSearchParams(body);
  const seen = new Set<string>();
  for (const key of parameters.keys()) {
    if (!allowedFields.has(key) || seen.has(key)) throw new BetaApplicationRequestError(400);
    seen.add(key);
  }
  if (seen.size !== allowedFields.size) throw new BetaApplicationRequestError(400);
  return parameters;
}

function validateContentType(value: string | null): void {
  if (value === null) throw new BetaApplicationRequestError(415);
  const parts = value.split(";").map((part) => part.trim().toLowerCase());
  if (
    parts[0] !== "application/x-www-form-urlencoded"
    || parts.length > 2
    || (parts.length === 2 && parts[1] !== "charset=utf-8")
  ) {
    throw new BetaApplicationRequestError(415);
  }
}

function validatePercentEncoding(body: string): void {
  if (/%(?![0-9a-f]{2})/iu.test(body)) throw new Error("malformed percent encoding");
  for (const segment of body.split("&")) {
    const [key = "", value = ""] = segment.split("=", 2);
    decodeURIComponent(key.replaceAll("+", " "));
    decodeURIComponent(value.replaceAll("+", " "));
  }
}

function requiredField(parameters: URLSearchParams, name: string): string {
  const value = parameters.get(name);
  if (value === null) throw new Error("missing field");
  return value;
}

function successRedirect(): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: {
      "cache-control": "no-store",
      location: betaApplicationThanksUrl,
      "referrer-policy": "no-referrer"
    }
  });
}

function rateLimitedResponse(retryAfterSeconds: number): NextResponse {
  const retryAfter = Number.isSafeInteger(retryAfterSeconds)
    ? Math.min(86_400, Math.max(1, retryAfterSeconds))
    : 60;
  return safeResponse(429, { "retry-after": String(retryAfter) });
}

function safeResponse(status: number, extraHeaders: Record<string, string> = {}): NextResponse {
  const message = status === 429
    ? "Please try the beta application again later."
    : status === 503
      ? "The beta application service is temporarily unavailable."
      : "The beta application request could not be processed.";
  return new NextResponse(message, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "referrer-policy": "no-referrer",
      ...extraHeaders
    }
  });
}
