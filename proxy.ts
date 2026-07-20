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
import { demoGuestCan } from "@/lib/public-demo-capabilities";
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
  const isDemoApi = pathname === "/api/demo" || pathname.startsWith("/api/demo/");
  const apiRoute = isApi ? resolveApiRoute(pathname) : null;
  const apiAccess = isApi ? resolveApiAccess(pathname, request.method) : null;
  const apiRequestPolicy = isApi ? resolveApiMethodPolicy(pathname, request.method) : null;
  const protectsApi = apiAccess?.kind === "permission" || apiAccess?.kind === "demo-session";
  const disabledPublicArchive = isPublicArchivePath(pathname) && !publicArchiveEnabled();
  const protectsPage = disabledPublicArchive
    || protectedPagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const protectResponse = <ResponseType extends NextResponse>(response: ResponseType): ResponseType =>
    protectsApi || protectsPage || isDemoApi ? markPrivateNoIndex(response) : response;

  if (isApi && !apiRoute) {
    if (isApiV1Path(pathname)) {
      return apiV1ErrorResponse(404, "not_found", "Not found", createApiV1RequestId());
    }
    return protectResponse(apiErrorResponse(404, "Not found"));
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
    return protectResponse(apiErrorResponse(405, "Method not allowed", {
      headers: { allow: allowedApiMethods(apiRoute).join(", ") }
    }));
  }

  if (
    apiRequestPolicy === "marketing-native-form"
    && !evaluateBetaApplicationNativeFormRequest(request)
  ) {
    return apiErrorResponse(403, "Forbidden");
  }

  if (apiRequestPolicy === "same-origin-cookie") {
    const sameOriginEvaluation = evaluateSameOriginRequest(request);
    if (sameOriginEvaluation === "misconfigured") {
      return protectResponse(apiErrorResponse(503, "Application request origin is not configured"));
    }
    if (sameOriginEvaluation === "forbidden") {
      return protectResponse(apiErrorResponse(403, "Forbidden"));
    }
  }

  if (isApi && isApiWriteBlockedByReleaseFence(pathname, request.method)) {
    try {
      const activeFence = await getActiveReleaseFence();
      if (activeFence) return protectResponse(releaseFenceLockedResponse(activeFence));
    } catch {
      return protectResponse(apiErrorResponse(503, "Release write safety check unavailable", {
        headers: { "cache-control": "private, no-store" }
      }));
    }
  }

  if (!process.env.AUTH_SECRET) {
    if (process.env.NODE_ENV === "production") {
      const requiresAuthConfiguration = apiRoute?.requiresAuthSecret === true;
      if (!requiresAuthConfiguration && !protectsApi && !protectsPage) {
        return protectResponse(NextResponse.next());
      }

      const message = "Private workspace authentication is not configured";
      return isApi
        ? protectResponse(apiErrorResponse(503, message))
        : protectResponse(new NextResponse(message, { status: 503 }));
    }

    // Local development stays open until auth is configured, matching the
    // previous password-gate behavior; lib/auth-session.ts mirrors this.
    return protectResponse(NextResponse.next());
  }

  if (disabledPublicArchive) {
    const loginUrl = process.env.APP_BASE_URL
      ? new URL("/login", process.env.APP_BASE_URL)
      : new URL("/login", request.nextUrl);
    loginUrl.searchParams.set("next", "/app");
    const response = NextResponse.redirect(loginUrl);
    response.headers.set("x-robots-tag", "noindex, nofollow, noarchive");
    return protectResponse(response);
  }

  if (!protectsApi && !protectsPage) {
    return protectResponse(NextResponse.next());
  }

  // Resolve the request principal and its server-owned archive before private
  // access. Member sessions still require persisted archive membership; demo
  // guests resolve only through their expiring token digest. Neither path
  // accepts an archive identifier from the request.
  await ensureDatabaseSchema();
  const context = await getSessionContext(request.headers);
  if (context) {
    if (apiAccess?.kind === "demo-session") {
      if (context.kind !== "demo-guest" || !demoGuestCan(apiAccess.capability)) {
        return protectResponse(apiErrorResponse(403, "Forbidden"));
      }
    }

    if (
      apiAccess?.kind === "permission"
      && context.kind === "demo-guest"
      && !demoGuestCan(apiAccess.permission)
    ) {
      return protectResponse(apiErrorResponse(403, "Forbidden"));
    }

    return protectResponse(NextResponse.next());
  }

  if (protectsApi) {
    return protectResponse(apiErrorResponse(401, "Authentication required"));
  }

  const loginUrl = process.env.APP_BASE_URL
    ? new URL("/login", process.env.APP_BASE_URL)
    : request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return protectResponse(NextResponse.redirect(loginUrl));
}

function markPrivateNoIndex<ResponseType extends NextResponse>(response: ResponseType): ResponseType {
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  return response;
}

export const config = {
  matcher: [
    "/",
    "/people/:path*",
    "/places/:path*",
    "/stories/:path*",
    "/kinresolve/:path*",
    "/app/:path*",
    "/api/:path*"
  ]
};
