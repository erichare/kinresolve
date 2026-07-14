import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

type ApiErrorResponseOptions = {
  requestId?: string;
  headers?: HeadersInit;
};

export function createApiRequestId(): string {
  return randomUUID();
}

export function apiErrorResponse(
  status: number,
  error: string,
  options: ApiErrorResponseOptions = {}
): NextResponse {
  const headers = new Headers(options.headers);
  headers.set("x-request-id", options.requestId ?? createApiRequestId());

  return NextResponse.json({ error }, { status, headers });
}
