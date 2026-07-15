import { NextRequest, NextResponse } from "next/server";
import {
  allowedApiMethods,
  isApiWriteBlockedByReleaseFence,
  resolveApiAccess,
  resolveApiMethodPolicy,
  resolveApiRoute
} from "@/lib/api-access";
import { apiErrorResponse } from "@/lib/api-response";
import { evaluateBetaApplicationNativeFormRequest } from "@/lib/beta-application-http";
import {
  apiV1ErrorResponse,
  createApiV1RequestId,
  isApiV1Path
} from "@/lib/api-v1-http";
import { getSessionContext } from "@/lib/auth-session";
import { ensureDatabaseSchema } from "@/lib/db";
import { resolveHostedCapabilities } from "@/lib/hosted-capabilities";
import {
  isPublicArchivePath,
  publicArchiveEnabled
} from "@/lib/public-surface";
import { evaluateSameOriginRequest } from "@/lib/same-origin-request";
import { getActiveReleaseFence } from "@/lib/release-fence";
import { releaseFenceLockedResponse } from "@/lib/release-fence-http";

const protectedPagePrefixes = ["/app"];

// Next 16's proxy runs on the Node runtime, so full database-backed session
// validation stays centralized here. Refresh Set-Cookie headers from session
// renewal cannot be forwarded through NextResponse.next(); renewals happen on
// route-handler traffic instead (see lib/auth.ts).
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isDnaPage = pathname === "/app/dna" || pathname.startsWith("/app/dna/");

  if (isDnaPage) {
    let dnaEnabled: boolean;
    try {
      dnaEnabled = resolveHostedCapabilities().dna;
    } catch {
      return new NextResponse("Capability configuration unavailable", {
        status: 503,
        headers: { "cache-control": "private, no-store" }
      });
    }
    if (!dnaEnabled) {
      return new NextResponse("Not found", {
        status: 404,
        headers: {
          "cache-control": "private, no-store",
          "x-robots-tag": "noindex, nofollow, noarchive"
        }
      });
    }
  }

  const isApi = pathname === "/api" || pathname.startsWith("/api/");
  const apiRoute = isApi ? resolveApiRoute(pathname) : null;
  const apiAccess = isApi ? resolveApiAccess(pathname, request.method) : null;
  const apiRequestPolicy = isApi ? resolveApiMethodPolicy(pathname, request.method) : null;
  const protectsApi = apiAccess?.kind === "permission";
  const disabledPublicArchive = isPublicArchivePath(pathname) && !publicArchiveEnabled();
  const protectsPage = disabledPublicArchive
    || protectedPagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  if (isApi && !apiRoute) {
    if (isApiV1Path(pathname)) {
      return apiV1ErrorResponse(404, "not_found", "Not found", createApiV1RequestId());
    }
    return apiErrorResponse(404, "Not found");
  }

  if (isApi && apiRoute && !apiAccess) {
    if (isApiV1Path(pathname)) {
      return apiV1ErrorResponse(
        405,
        "method_not_allowed",
        "Method not allowed",
        createApiV1RequestId(),
        { headers: { allow: allowedApiMethods(apiRoute).join(", ") } }
      );
    }
    return apiErrorResponse(405, "Method not allowed", {
      headers: { allow: allowedApiMethods(apiRoute).join(", ") }
    });
  }

  if (
    apiRequestPolicy === "marketing-native-form"
    && !evaluateBetaApplicationNativeFormRequest(request)
  ) {
    return apiErrorResponse(403, "Forbidden");
  }

  if (isApi && isApiWriteBlockedByReleaseFence(pathname, request.method)) {
    try {
      const activeFence = await getActiveReleaseFence();
      if (activeFence) return releaseFenceLockedResponse(activeFence);
    } catch {
      return apiErrorResponse(503, "Release write safety check unavailable", {
        headers: { "cache-control": "private, no-store" }
      });
    }
  }

  if (apiRequestPolicy === "same-origin-cookie") {
    const sameOriginEvaluation = evaluateSameOriginRequest(request);
    if (sameOriginEvaluation === "misconfigured") {
      return apiErrorResponse(503, "Application request origin is not configured");
    }
    if (sameOriginEvaluation === "forbidden") {
      return apiErrorResponse(403, "Forbidden");
    }
  }

  if (!process.env.AUTH_SECRET) {
    if (process.env.NODE_ENV === "production") {
      const requiresAuthConfiguration = apiRoute?.requiresAuthSecret === true;
      if (!requiresAuthConfiguration && !protectsApi && !protectsPage) {
        return NextResponse.next();
      }

      const message = "Private workspace authentication is not configured";
      return isApi
        ? apiErrorResponse(503, message)
        : new NextResponse(message, { status: 503 });
    }

    // Local development stays open until auth is configured, matching the
    // previous password-gate behavior; lib/auth-session.ts mirrors this.
    return NextResponse.next();
  }

  if (disabledPublicArchive) {
    const loginUrl = process.env.APP_BASE_URL
      ? new URL("/login", process.env.APP_BASE_URL)
      : new URL("/login", request.nextUrl);
    loginUrl.searchParams.set("next", "/app");
    const response = NextResponse.redirect(loginUrl);
    response.headers.set("x-robots-tag", "noindex, nofollow, noarchive");
    return response;
  }

  if (!protectsApi && !protectsPage) {
    return NextResponse.next();
  }

  // Gate on archive MEMBERSHIP, not merely session existence: an
  // authenticated account with no membership (e.g. an open-signup account, or
  // one created by racing first-run setup) must not reach private data.
  // getSessionContext resolves session -> membership and returns null for
  // both anonymous callers and membership-less accounts.
  await ensureDatabaseSchema();
  const context = await getSessionContext(request.headers);
  if (context) {
    return NextResponse.next();
  }

  if (protectsApi) {
    return apiErrorResponse(401, "Authentication required");
  }

  const loginUrl = process.env.APP_BASE_URL
    ? new URL("/login", process.env.APP_BASE_URL)
    : request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/",
    "/people/:path*",
    "/places/:path*",
    "/stories/:path*",
    "/kinsleuth/:path*",
    "/app/:path*",
    "/api/:path*"
  ]
};
