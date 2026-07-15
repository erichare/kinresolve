import { createHmac, timingSafeEqual } from "node:crypto";

import { isApiV1ResourceId } from "./api-v1-contract";

export type ApiV1CursorKey = {
  sortOrder: number;
  id: string;
};

export type ApiV1PageRequest = {
  limit: number;
  cursor: ApiV1CursorKey | null;
};

type CursorPayload = {
  v: 1;
  binding: string;
  sortOrder: number;
  id: string;
};

export class ApiV1CursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiV1CursorError";
  }
}

export function parseApiV1PageRequest(
  url: URL,
  routeTemplate: string,
  archiveId: string,
  environment: Record<string, string | undefined> = process.env
): ApiV1PageRequest {
  for (const key of url.searchParams.keys()) {
    if (key !== "limit" && key !== "cursor") {
      throw new ApiV1CursorError("Unsupported query parameter");
    }
  }

  if (url.searchParams.getAll("limit").length > 1 || url.searchParams.getAll("cursor").length > 1) {
    throw new ApiV1CursorError("Query parameters may be provided only once");
  }

  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 25 : parseLimit(rawLimit);
  const rawCursor = url.searchParams.get("cursor");
  if (rawCursor !== null && (rawCursor.length < 1 || rawCursor.length > 2_048)) {
    throw new ApiV1CursorError("The cursor is invalid");
  }
  const cursor = rawCursor === null
    ? null
    : decodeApiV1Cursor(rawCursor, routeTemplate, archiveId, environment);

  return { limit, cursor };
}

export function encodeApiV1Cursor(
  key: ApiV1CursorKey,
  routeTemplate: string,
  archiveId: string,
  environment: Record<string, string | undefined> = process.env
): string {
  validateCursorKey(key);
  const secret = cursorSecret(environment);
  const payload: CursorPayload = {
    v: 1,
    binding: bindingDigest(secret, routeTemplate, archiveId),
    sortOrder: key.sortOrder,
    id: key.id
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(secret, encoded)}`;
}

export function decodeApiV1Cursor(
  value: string,
  routeTemplate: string,
  archiveId: string,
  environment: Record<string, string | undefined> = process.env
): ApiV1CursorKey {
  const secret = cursorSecret(environment);
  const parts = value.split(".");
  if (
    parts.length !== 2
    || !parts[0]
    || !/^[A-Za-z0-9_-]+$/.test(parts[0])
    || !/^[A-Za-z0-9_-]{43}$/.test(parts[1] ?? "")
  ) {
    throw new ApiV1CursorError("The cursor is invalid");
  }

  const expectedSignature = Buffer.from(signature(secret, parts[0]), "base64url");
  let receivedSignature: Buffer;
  try {
    receivedSignature = Buffer.from(parts[1], "base64url");
    if (receivedSignature.toString("base64url") !== parts[1]) {
      throw new Error("non-canonical signature");
    }
  } catch {
    throw new ApiV1CursorError("The cursor is invalid");
  }
  if (
    receivedSignature.length !== expectedSignature.length
    || !timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    throw new ApiV1CursorError("The cursor is invalid");
  }

  let payload: unknown;
  try {
    const decodedPayload = Buffer.from(parts[0], "base64url");
    if (decodedPayload.toString("base64url") !== parts[0]) {
      throw new Error("non-canonical payload");
    }
    payload = JSON.parse(decodedPayload.toString("utf8"));
  } catch {
    throw new ApiV1CursorError("The cursor is invalid");
  }
  if (!isCursorPayload(payload)) {
    throw new ApiV1CursorError("The cursor is invalid");
  }
  if (payload.binding !== bindingDigest(secret, routeTemplate, archiveId)) {
    throw new ApiV1CursorError("The cursor is invalid for this resource");
  }

  const key = { sortOrder: payload.sortOrder, id: payload.id };
  validateCursorKey(key);
  return key;
}

function parseLimit(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new ApiV1CursorError("limit must be an integer from 1 through 100");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 100) {
    throw new ApiV1CursorError("limit must be an integer from 1 through 100");
  }
  return parsed;
}

function cursorSecret(environment: Record<string, string | undefined>): string {
  const secret = environment.KINRESOLVE_API_CURSOR_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("KINRESOLVE_API_CURSOR_SECRET must contain at least 32 bytes when API v1 is enabled");
  }
  return secret;
}

function bindingDigest(secret: string, routeTemplate: string, archiveId: string): string {
  return createHmac("sha256", secret)
    .update("kinresolve-api-v1-cursor-binding\0")
    .update(routeTemplate)
    .update("\0")
    .update(archiveId)
    .digest("base64url");
}

function signature(secret: string, encodedPayload: string): string {
  return createHmac("sha256", secret)
    .update("kinresolve-api-v1-cursor-signature\0")
    .update(encodedPayload)
    .digest("base64url");
}

function isCursorPayload(value: unknown): value is CursorPayload {
  return typeof value === "object"
    && value !== null
    && Object.keys(value).length === 4
    && (value as CursorPayload).v === 1
    && typeof (value as CursorPayload).binding === "string"
    && typeof (value as CursorPayload).sortOrder === "number"
    && Number.isSafeInteger((value as CursorPayload).sortOrder)
    && typeof (value as CursorPayload).id === "string";
}

function validateCursorKey(key: ApiV1CursorKey): void {
  if (
    !Number.isSafeInteger(key.sortOrder)
    || key.sortOrder < -2_147_483_648
    || key.sortOrder > 2_147_483_647
  ) {
    throw new ApiV1CursorError("The cursor is invalid");
  }
  if (!isApiV1ResourceId(key.id)) {
    throw new ApiV1CursorError("The cursor is invalid");
  }
}
