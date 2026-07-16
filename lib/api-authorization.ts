import { NextResponse } from "next/server";

import { apiErrorResponse, createApiRequestId } from "./api-response";
import {
  getSessionContext,
  type DemoGuestSessionContext,
  type MemberSessionContext
} from "./auth-session";
import {
  demoGuestCan,
  type DemoGuestCapability,
  type DemoGuestCommandCapability
} from "./public-demo-capabilities";
import { hasPermission, type Permission } from "./rbac";
import { captureOperationalError } from "./observability";

type AuthorizedMemberRequestContext = MemberSessionContext & {
  requestId: string;
};

type AuthorizedGenericDemoRequestContext = DemoGuestSessionContext & {
  requestId: string;
  // Compatibility actor fields are request-local labels, not a membership
  // row and not part of the persisted Role union. Generic write permissions
  // remain denied by demoGuestCan below.
  userId: string;
  email: "";
  name: "Demo Guest";
  role: "viewer";
};

export type AuthorizedRequestContext =
  | AuthorizedMemberRequestContext
  | AuthorizedGenericDemoRequestContext;

export type AuthorizedDemoGuestContext = DemoGuestSessionContext & {
  requestId: string;
};

export type PermissionResult =
  | { ok: true; context: AuthorizedRequestContext }
  | { ok: false; response: NextResponse };

export async function requirePermission(
  request: Request,
  permission: Permission
): Promise<PermissionResult> {
  const requestId = createApiRequestId();

  try {
    const session = await getSessionContext(request.headers);
    if (!session) {
      return deniedResponse(401, "Authentication required", requestId);
    }
    if (session.kind === "demo-guest") {
      if (!demoGuestCan(permission) || !genericDemoRouteAllowed(request, permission)) {
        return deniedResponse(403, "Permission denied", requestId);
      }
      return {
        ok: true,
        context: {
          ...session,
          requestId,
          userId: `demo:${session.sessionId}`,
          email: "",
          name: "Demo Guest",
          role: "viewer"
        }
      };
    }
    if (!hasPermission(session.role, permission)) {
      return deniedResponse(403, "Permission denied", requestId);
    }

    return {
      ok: true,
      context: {
        ...session,
        requestId
      }
    };
  } catch (error) {
    await captureOperationalError({
      event: "api_error",
      requestId,
      route: "/api/authorization"
    }, error);
    return deniedResponse(500, "Authorization check failed", requestId);
  }
}

export async function requireDemoGuestCapability(
  request: Request,
  capability: DemoGuestCommandCapability
): Promise<
  | { ok: true; context: AuthorizedDemoGuestContext }
  | { ok: false; response: NextResponse }
> {
  const requestId = createApiRequestId();
  try {
    const session = await getSessionContext(request.headers);
    if (!session) return deniedResponse(401, "Demo session required", requestId);
    if (session.kind !== "demo-guest" || !demoGuestCan(capability)) {
      return deniedResponse(403, "Permission denied", requestId);
    }
    return { ok: true, context: { ...session, requestId } };
  } catch (error) {
    await captureOperationalError({
      event: "api_error",
      requestId,
      route: "/api/demo/authorization"
    }, error);
    return deniedResponse(500, "Authorization check failed", requestId);
  }
}

export function withDemoGuestCapability<RouteArguments extends unknown[]>(
  capability: DemoGuestCommandCapability,
  handler: (
    request: Request,
    context: AuthorizedDemoGuestContext,
    ...arguments_: RouteArguments
  ) => Response | Promise<Response>
): (request: Request, ...arguments_: RouteArguments) => Promise<Response> {
  return async (request, ...arguments_) => {
    const authorization = await requireDemoGuestCapability(request, capability);
    if (!authorization.ok) return authorization.response;
    const response = await handler(request, authorization.context, ...arguments_);
    response.headers.set("x-request-id", authorization.context.requestId);
    return response;
  };
}

export function withPermission<RouteArguments extends unknown[]>(
  permission: Permission,
  handler: (
    request: Request,
    context: AuthorizedRequestContext,
    ...arguments_: RouteArguments
  ) => Response | Promise<Response>
): (request: Request, ...arguments_: RouteArguments) => Promise<Response> {
  return async (request, ...arguments_) => {
    const authorization = await requirePermission(request, permission);
    if (!authorization.ok) return authorization.response;

    const response = await handler(request, authorization.context, ...arguments_);
    response.headers.set("x-request-id", authorization.context.requestId);
    return response;
  };
}

function deniedResponse(
  status: number,
  error: string,
  requestId: string
): Extract<PermissionResult, { ok: false }> {
  return {
    ok: false,
    response: apiErrorResponse(status, error, { requestId })
  };
}

const genericDemoReadRoutes = new Set([
  "/api/cases",
  "/api/dna/matches",
  "/api/people",
  "/api/publishing/readiness",
  "/api/reports/quality",
  "/api/sources"
]);

function genericDemoRouteAllowed(request: Request, permission: DemoGuestCapability): boolean {
  if (request.method !== "GET") return false;
  if (!genericDemoReadRoutes.has(new URL(request.url).pathname)) return false;
  return demoGuestCan(permission);
}
