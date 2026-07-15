import type { ApiV1Scope } from "./api-v1-contract";
import { ApiV1CursorError } from "./api-v1-cursor";
import {
  apiV1ErrorResponse,
  applyApiV1Headers,
  createApiV1RequestId,
  type ApiV1ErrorCode
} from "./api-v1-http";
import { authenticateApiToken } from "./beta-api-tokens";
import { captureOperationalError, emitOperationalEvent } from "./observability";

export type ApiV1AuthorizedContext = Extract<
  Awaited<ReturnType<typeof authenticateApiToken>>,
  { ok: true }
>["context"];

export function withApiV1Token<RouteArguments extends unknown[]>(
  scope: ApiV1Scope,
  routeTemplate: string,
  handler: (
    request: Request,
    context: ApiV1AuthorizedContext,
    ...arguments_: RouteArguments
  ) => Response | Promise<Response>
): (request: Request, ...arguments_: RouteArguments) => Promise<Response> {
  return async (request, ...arguments_) => {
    const requestId = createApiV1RequestId();
    const startedAt = performance.now();
    let authentication: Awaited<ReturnType<typeof authenticateApiToken>>;
    try {
      authentication = await authenticateApiToken(request, {
        scope,
        routeTemplate,
        requestId
      });
    } catch (error) {
      await captureOperationalError({ event: "api_error", requestId, route: routeTemplate }, error);
      const response = apiV1ErrorResponse(
        503,
        "service_unavailable",
        "The API is temporarily unavailable",
        requestId
      );
      emitRequestTelemetry(routeTemplate, requestId, response.status, startedAt);
      return response;
    }

    if (!authentication.ok) {
      const response = apiV1ErrorResponse(
        authentication.status,
        authentication.code as ApiV1ErrorCode,
        authentication.message,
        authentication.requestId,
        {
          rateLimit: authentication.rateLimit,
          ...(authentication.status === 403 ? { requiredScope: scope } : {})
        }
      );
      emitRequestTelemetry(routeTemplate, authentication.requestId, response.status, startedAt);
      return response;
    }

    try {
      const response = await handler(request, authentication.context, ...arguments_);
      applyApiV1Headers(response, requestId, authentication.context.rateLimit);
      emitRequestTelemetry(
        routeTemplate,
        requestId,
        response.status,
        startedAt,
        authentication.context.tokenId
      );
      return response;
    } catch (error) {
      if (error instanceof ApiV1CursorError) {
        const response = apiV1ErrorResponse(400, "invalid_request", error.message, requestId, {
          rateLimit: authentication.context.rateLimit
        });
        emitRequestTelemetry(routeTemplate, requestId, response.status, startedAt, authentication.context.tokenId);
        return response;
      }

      await captureOperationalError({
        event: "api_error",
        requestId,
        route: routeTemplate
      }, error);
      const response = apiV1ErrorResponse(
        500,
        "internal_error",
        "The request could not be completed",
        requestId,
        { rateLimit: authentication.context.rateLimit }
      );
      emitRequestTelemetry(routeTemplate, requestId, response.status, startedAt, authentication.context.tokenId);
      return response;
    }
  };
}

function emitRequestTelemetry(
  route: string,
  requestId: string,
  status: number,
  startedAt: number,
  tokenId?: string
): void {
  void emitOperationalEvent({
    event: "api_request",
    severity: status >= 500 ? "error" : status >= 400 ? "warning" : "info",
    durationMs: Math.max(0, performance.now() - startedAt),
    requestId,
    route,
    statusClass: `${Math.trunc(status / 100)}xx` as "2xx" | "3xx" | "4xx" | "5xx",
    tokenId
  });
}
