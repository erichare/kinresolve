import type { NextRequest } from "next/server";
import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";
import { countUsers } from "@/lib/auth-session";
import { apiErrorResponse, createApiRequestId } from "@/lib/api-response";
import {
  evaluateHostedAuthRateLimit,
  HostedAuthRequestValidationError
} from "@/lib/auth-route-rate-limit";
import { ensureDatabaseSchema } from "@/lib/db";
import { readAllowSignupsSetting } from "@/lib/environment-aliases";
import { isHostedDeployment } from "@/lib/hosted-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const hosted = isHostedDeployment();
  if (
    hosted
    && (
      request.nextUrl.pathname === "/api/auth/list-sessions"
      || /^\/api\/auth\/reset-password\/[^/]+$/.test(request.nextUrl.pathname)
    )
  ) {
    // Hosted recovery uses an app-owned fragment link, never Better Auth's
    // token-to-query compatibility redirect. Session inventory is also kept
    // server-side so browser JavaScript cannot enumerate device credentials.
    return apiErrorResponse(404, "Not found", { headers: privateNoStoreHeaders() });
  }
  await ensureDatabaseSchema();
  return decorateAuthResponse(await toNextJsHandler(getAuth().handler).GET(request));
}

export async function POST(request: NextRequest) {
  const signUpRequest = request.nextUrl.pathname.startsWith("/api/auth/sign-up");
  const hosted = isHostedDeployment();
  if (hosted && hostedBlockedSessionMutation(request.nextUrl.pathname)) {
    return apiErrorResponse(404, "Not found", { headers: privateNoStoreHeaders() });
  }
  if (signUpRequest && hosted) {
    return apiErrorResponse(403, "Sign-up is unavailable.", { headers: privateNoStoreHeaders() });
  }

  if (hosted) {
    try {
      const rateLimit = await evaluateHostedAuthRateLimit(request);
      if (!rateLimit.allowed) {
        return apiErrorResponse(429, "Too many requests. Try again later.", {
          headers: {
            ...privateNoStoreHeaders(),
            "retry-after": String(Math.max(1, rateLimit.retryAfterSeconds))
          }
        });
      }
    } catch (error) {
      if (error instanceof HostedAuthRequestValidationError) {
        return hostedAuthRequestValidationResponse(error);
      }
      return apiErrorResponse(503, "Authentication safety check unavailable.", {
        headers: privateNoStoreHeaders()
      });
    }
  }

  await ensureDatabaseSchema();

  // Open sign-up is only for first-run setup: once an account exists, new
  // members arrive via invitations (a later slice), not self-registration.
  // This is a best-effort UX gate — it need not be perfectly atomic, because
  // any account slipping past a race stays membership-less, and only the
  // earliest account self-heals to owner (see resolveMembershipRole). A
  // membership-less account is denied at the proxy, so the worst a race can do
  // is create an extra, powerless account.
  if (signUpRequest && readAllowSignupsSetting() !== "true") {
    if ((await countUsers()) > 0) {
      return apiErrorResponse(403, "Sign-up is disabled. Ask the archive owner for an invitation.", {
        headers: privateNoStoreHeaders()
      });
    }
  }

  return decorateAuthResponse(await toNextJsHandler(getAuth().handler).POST(request));
}

function hostedBlockedSessionMutation(pathname: string): boolean {
  return pathname === "/api/auth/revoke-session"
    || pathname === "/api/auth/revoke-sessions"
    || pathname === "/api/auth/revoke-other-sessions";
}

function decorateAuthResponse(response: Response): Response {
  response.headers.set("cache-control", "private, no-store");
  if (!response.headers.has("x-request-id")) {
    response.headers.set("x-request-id", createApiRequestId());
  }
  return response;
}

function privateNoStoreHeaders(): Record<string, string> {
  return { "cache-control": "private, no-store" };
}

function hostedAuthRequestValidationResponse(error: HostedAuthRequestValidationError): Response {
  if (error.code === "PAYLOAD_TOO_LARGE") {
    return apiErrorResponse(413, "Authentication request is too large.", {
      headers: privateNoStoreHeaders()
    });
  }
  if (error.code === "UNSUPPORTED_MEDIA_TYPE") {
    return apiErrorResponse(415, "Authentication requests must use application/json.", {
      headers: privateNoStoreHeaders()
    });
  }
  return apiErrorResponse(400, "Authentication request is invalid.", {
    headers: privateNoStoreHeaders()
  });
}
