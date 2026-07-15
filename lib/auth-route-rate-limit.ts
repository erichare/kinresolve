import type { NextRequest } from "next/server";

import { clientAddressRateLimitSubject } from "./auth-rate-limit-subject";
import {
  consumeDurableAuthRateLimit,
  type ConsumeDurableAuthRateLimitInput,
  type DurableAuthRateLimitResult
} from "./durable-auth-rate-limit";

type Environment = Record<string, string | undefined>;
type Consume = (input: ConsumeDurableAuthRateLimitInput) => Promise<DurableAuthRateLimitResult>;

export type HostedAuthRateLimitEvaluation = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export type HostedAuthRequestValidationErrorCode =
  | "MALFORMED_BODY"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE";

export class HostedAuthRequestValidationError extends Error {
  constructor(readonly code: HostedAuthRequestValidationErrorCode) {
    super("The hosted authentication request body is invalid.");
    this.name = "HostedAuthRequestValidationError";
  }
}

const maximumInspectionBodyBytes = 4 * 1024;
const rateLimitedPaths = new Set([
  "/api/auth/request-password-reset",
  "/api/auth/reset-password",
  "/api/auth/sign-in/email"
]);

export async function evaluateHostedAuthRateLimit(
  request: NextRequest,
  options: { consume?: Consume; environment?: Environment } = {}
): Promise<HostedAuthRateLimitEvaluation> {
  const environment = options.environment ?? process.env;
  const consume = options.consume ?? ((input) => consumeDurableAuthRateLimit(input));
  const hmacSecret = environment.KINRESOLVE_BETA_PRIVACY_HMAC_SECRET ?? "";
  const path = request.nextUrl.pathname;
  if (!rateLimitedPaths.has(path)) return { allowed: true, retryAfterSeconds: 0 };

  const body = await readRequiredJsonBody(request);
  const policies = policiesFor(path, body, clientAddressRateLimitSubject(request, environment));
  const [clientPolicy, ...privateSubjectPolicies] = policies;
  if (!clientPolicy) throw new Error("The hosted authentication rate-limit policy is invalid.");
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
  const results = await Promise.all(privateSubjectPolicies.map((policy) => consume({
    ...policy,
    hmacSecret
  })));
  return {
    allowed: results.every((result) => result.allowed),
    retryAfterSeconds: Math.max(0, ...results.map((result) => result.retryAfterSeconds))
  };
}

function policiesFor(
  pathname: string,
  body: Record<string, unknown>,
  clientSubject: string
): Array<Omit<ConsumeDurableAuthRateLimitInput, "hmacSecret">> {
  if (pathname === "/api/auth/request-password-reset") {
    return [
      policy("auth:password-reset-request:ip", clientSubject, 10, 60 * 60),
      policy("auth:password-reset-request:email", requiredEmailSubject(body), 3, 60 * 60)
    ];
  }
  if (pathname === "/api/auth/reset-password") {
    return [
      policy("auth:password-reset-consume:ip", clientSubject, 10, 30 * 60),
      policy("auth:password-reset-consume:token", requiredTokenSubject(body), 6, 30 * 60)
    ];
  }
  if (pathname === "/api/auth/sign-in/email") {
    return [
      policy("auth:sign-in:ip", clientSubject, 30, 15 * 60),
      policy("auth:sign-in:email", requiredEmailSubject(body), 10, 15 * 60)
    ];
  }
  throw new Error("The hosted authentication rate-limit path is invalid.");
}

function policy(
  scope: string,
  subject: string,
  maximumRequests: number,
  windowSeconds: number
): Omit<ConsumeDurableAuthRateLimitInput, "hmacSecret"> {
  return { maximumRequests, scope, subject, windowSeconds };
}

function requiredEmailSubject(body: Record<string, unknown>): string {
  const subject = emailSubject(body);
  if (subject === null) throw new HostedAuthRequestValidationError("MALFORMED_BODY");
  return subject;
}

function requiredTokenSubject(body: Record<string, unknown>): string {
  const subject = tokenSubject(body);
  if (subject === null) throw new HostedAuthRequestValidationError("MALFORMED_BODY");
  return subject;
}

function emailSubject(body: Record<string, unknown>): string | null {
  const value = body.email;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 254 || !normalized.includes("@")) return null;
  return `email:${normalized}`;
}

function tokenSubject(body: Record<string, unknown>): string | null {
  const value = body.token;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,512}$/.test(value)) return null;
  return `reset-token:${value}`;
}

async function readRequiredJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new HostedAuthRequestValidationError("UNSUPPORTED_MEDIA_TYPE");
  }

  const declaredLengthHeader = request.headers.get("content-length");
  if (declaredLengthHeader !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(declaredLengthHeader)) {
      throw new HostedAuthRequestValidationError("MALFORMED_BODY");
    }
    if (BigInt(declaredLengthHeader) > BigInt(maximumInspectionBodyBytes)) {
      throw new HostedAuthRequestValidationError("PAYLOAD_TOO_LARGE");
    }
  }

  let clone: Request;
  try {
    clone = request.clone();
  } catch {
    throw new HostedAuthRequestValidationError("MALFORMED_BODY");
  }
  if (!clone.body) throw new HostedAuthRequestValidationError("MALFORMED_BODY");
  const reader = clone.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumInspectionBodyBytes) {
        // A cloned Request body is a tee. Awaiting cancellation can wait for
        // the untouched Better Auth branch and deadlock this rejection path.
        void reader.cancel().catch(() => undefined);
        throw new HostedAuthRequestValidationError("PAYLOAD_TOO_LARGE");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new HostedAuthRequestValidationError("MALFORMED_BODY");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HostedAuthRequestValidationError) throw error;
    throw new HostedAuthRequestValidationError("MALFORMED_BODY");
  }
}
