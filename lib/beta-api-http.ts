import { NextResponse, type NextRequest } from "next/server";

import { apiErrorResponse } from "./api-response";
import { clientAddressRateLimitSubject } from "./auth-rate-limit-subject";
import {
  consumeDurableAuthRateLimit,
  type ConsumeDurableAuthRateLimitInput,
  type DurableAuthRateLimitResult
} from "./durable-auth-rate-limit";

type Consume = (input: ConsumeDurableAuthRateLimitInput) => Promise<DurableAuthRateLimitResult>;
type Environment = Record<string, string | undefined>;

export type BetaRateLimitPolicy = {
  maximumRequests: number;
  scope: string;
  subject: string;
  windowSeconds: number;
};

const maximumBodyBytes = 16 * 1024;

export async function readBetaJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new Error("INVALID_BETA_JSON");
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBodyBytes) {
    throw new Error("INVALID_BETA_JSON");
  }
  if (!request.body) throw new Error("INVALID_BETA_JSON");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBodyBytes) {
        await reader.cancel();
        throw new Error("INVALID_BETA_JSON");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error("INVALID_BETA_JSON");
  }
}

export async function evaluateBetaRateLimits(
  request: NextRequest,
  policies: readonly BetaRateLimitPolicy[],
  options: { consume?: Consume; environment?: Environment } = {}
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const environment = options.environment ?? process.env;
  const consume = options.consume ?? ((input) => consumeDurableAuthRateLimit(input));
  const hmacSecret = environment.KINRESOLVE_BETA_PRIVACY_HMAC_SECRET ?? "";
  const clientPolicy = {
    maximumRequests: Math.max(20, ...policies.map((policy) => policy.maximumRequests * 2)),
    scope: `beta-route:${routeScope(request.nextUrl.pathname)}:ip`,
    subject: clientAddressRateLimitSubject(request, environment),
    windowSeconds: Math.max(15 * 60, ...policies.map((policy) => policy.windowSeconds))
  };
  const clientResult = await consume({
    ...clientPolicy,
    hmacSecret
  });
  if (!clientResult.allowed) {
    return {
      allowed: false,
      retryAfterSeconds: clientResult.retryAfterSeconds
    };
  }

  // Token and email subjects are attacker-controlled and high-cardinality.
  // Never create those buckets once the bounded client bucket is denied.
  const results = await Promise.all(policies.map((policy) => consume({
    ...policy,
    hmacSecret
  })));
  return {
    allowed: results.every((result) => result.allowed),
    retryAfterSeconds: Math.max(0, ...results.map((result) => result.retryAfterSeconds))
  };
}

export function betaJsonResponse(
  body: unknown,
  options: { requestId: string; status?: number }
): NextResponse {
  return NextResponse.json(body, {
    status: options.status ?? 200,
    headers: {
      "cache-control": "private, no-store",
      "x-request-id": options.requestId
    }
  });
}

export function betaErrorResponse(
  status: number,
  error: string,
  options: { requestId: string; retryAfterSeconds?: number }
): NextResponse {
  return apiErrorResponse(status, error, {
    requestId: options.requestId,
    headers: {
      "cache-control": "private, no-store",
      ...(options.retryAfterSeconds === undefined
        ? {}
        : { "retry-after": String(Math.max(1, options.retryAfterSeconds)) })
    }
  });
}

function routeScope(pathname: string): string {
  const normalized = pathname.replace(/^\/api\/beta\//, "").replaceAll("/", ":");
  if (!/^[a-z0-9][a-z0-9:-]{0,79}$/.test(normalized)) {
    throw new Error("The beta rate-limit route is invalid.");
  }
  return normalized;
}
