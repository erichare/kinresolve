import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export type ApiV1ErrorCode =
  | "api_disabled"
  | "invalid_request"
  | "invalid_token"
  | "insufficient_scope"
  | "not_found"
  | "method_not_allowed"
  | "rate_limit_exceeded"
  | "service_unavailable"
  | "internal_error";

export type ApiV1RateLimitHeaders = {
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
};

type ApiV1ResponseOptions = {
  status?: number;
  headers?: HeadersInit;
  rateLimit?: ApiV1RateLimitHeaders;
};

type ApiV1ErrorResponseOptions = Omit<ApiV1ResponseOptions, "status"> & {
  requiredScope?: string;
};

export function createApiV1RequestId(): string {
  return randomUUID();
}

export function isApiV1Path(pathname: string): boolean {
  return pathname === "/api/v1" || pathname.startsWith("/api/v1/");
}

export function apiV1JsonResponse(
  body: unknown,
  requestId: string,
  options: ApiV1ResponseOptions = {}
): NextResponse {
  const headers = apiV1Headers(requestId, options.headers, options.rateLimit);
  return NextResponse.json(body, { status: options.status ?? 200, headers });
}

export function apiV1CollectionResponse(
  body: { page: { nextCursor: string | null } },
  requestId: string,
  routePath: string,
  limit: number
): NextResponse {
  const headers = new Headers();
  if (body.page.nextCursor) {
    const query = new URLSearchParams({ limit: String(limit), cursor: body.page.nextCursor });
    headers.set("link", `<${routePath}?${query.toString()}>; rel="next"`);
  }
  return apiV1JsonResponse(body, requestId, { headers });
}

export function apiV1ErrorResponse(
  status: number,
  code: ApiV1ErrorCode,
  message: string,
  requestId = createApiV1RequestId(),
  options: ApiV1ErrorResponseOptions = {}
): NextResponse {
  const { requiredScope, ...responseOptions } = options;
  const headers = new Headers(responseOptions.headers);
  if (status === 401) {
    headers.set("www-authenticate", 'Bearer realm="Kin Resolve API", error="invalid_token"');
  }
  if (status === 403) {
    const scope = requiredScope ? `, scope="${requiredScope}"` : "";
    headers.set(
      "www-authenticate",
      `Bearer realm="Kin Resolve API", error="insufficient_scope"${scope}`
    );
  }
  if (status === 405 && !headers.has("allow")) {
    headers.set("allow", "GET");
  }
  return apiV1JsonResponse(
    { code, message, requestId },
    requestId,
    { ...responseOptions, status, headers }
  );
}

export function apiV1Headers(
  requestId: string,
  initial?: HeadersInit,
  rateLimit?: ApiV1RateLimitHeaders
): Headers {
  const headers = new Headers(initial);
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("pragma", "no-cache");
  headers.set("x-request-id", requestId);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  appendVary(headers, "Authorization");
  if (rateLimit) {
    headers.set("ratelimit-limit", String(rateLimit.limit));
    headers.set("ratelimit-remaining", String(Math.max(0, rateLimit.remaining)));
    headers.set("ratelimit-reset", String(rateLimit.reset));
    if (rateLimit.retryAfter !== undefined) {
      headers.set("retry-after", String(rateLimit.retryAfter));
    }
  }
  return headers;
}

export function applyApiV1Headers(
  response: Response,
  requestId: string,
  rateLimit?: ApiV1RateLimitHeaders
): Response {
  const headers = apiV1Headers(requestId, response.headers, rateLimit);
  for (const [name, value] of headers) response.headers.set(name, value);
  return response;
}

function appendVary(headers: Headers, value: string): void {
  const existing = headers.get("vary")
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean) ?? [];
  if (!existing.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
    existing.push(value);
  }
  headers.set("vary", existing.join(", "));
}
