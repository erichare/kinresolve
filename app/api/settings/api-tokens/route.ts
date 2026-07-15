import { NextResponse } from "next/server";
import { z } from "zod";

import { withPermission } from "@/lib/api-authorization";
import { apiV1Scopes } from "@/lib/api-v1-contract";
import {
  BetaApiTokenError,
  createApiTokenForOwner,
  listApiTokensForOwner,
  type ApiTokenMetadata
} from "@/lib/beta-api-tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(apiV1Scopes)).min(1).max(apiV1Scopes.length),
  expiresAt: z.string().datetime({ offset: true }),
  confirmArchiveExport: z.boolean().optional()
}).strict();

export const GET = withPermission("api-tokens:manage", async (_request, context) => {
  try {
    const tokens = await listApiTokensForOwner({
      archiveId: context.archiveId,
      userId: context.userId
    });
    return NextResponse.json({
      tokens: tokens.map(serializeTokenMetadata)
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return tokenManagementError(error);
  }
});

export const POST = withPermission("api-tokens:manage", async (request, context) => {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = createTokenSchema.safeParse(value);
  if (!parsed.success || new Set(parsed.data?.scopes).size !== parsed.data?.scopes.length) {
    return NextResponse.json({ error: "The API token request is invalid" }, { status: 400 });
  }
  if (parsed.data.scopes.includes("archive:export") && parsed.data.confirmArchiveExport !== true) {
    return NextResponse.json({
      error: "Confirm that this token can download the complete GEDCOM archive"
    }, { status: 400 });
  }

  try {
    const created = await createApiTokenForOwner({
      archiveId: context.archiveId,
      userId: context.userId,
      name: parsed.data.name,
      scopes: parsed.data.scopes,
      expiresAt: new Date(parsed.data.expiresAt),
      requestId: context.requestId
    });
    const { token, ...metadata } = created;
    return NextResponse.json({
      token,
      metadata: serializeTokenMetadata(metadata)
    }, {
      status: 201,
      headers: { "cache-control": "private, no-store" }
    });
  } catch (error) {
    return tokenManagementError(error);
  }
});

function serializeTokenMetadata(token: ApiTokenMetadata) {
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    scopes: token.scopes,
    active: token.revokedAt === null && token.expiresAt.getTime() > Date.now(),
    createdAt: token.createdAt.toISOString(),
    expiresAt: token.expiresAt.toISOString(),
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    revokedAt: token.revokedAt?.toISOString() ?? null
  };
}

function tokenManagementError(error: unknown): NextResponse {
  if (error instanceof BetaApiTokenError) {
    const status = error.code === "API_DISABLED"
      ? 404
      : error.code === "FORBIDDEN"
        ? 403
      : error.code === "INVALID_INPUT"
          ? 400
          : error.code === "LIMIT_EXCEEDED"
            ? 409
          : error.code === "NOT_FOUND"
            ? 404
            : 503;
    return NextResponse.json({ error: error.message }, {
      status,
      headers: { "cache-control": "private, no-store" }
    });
  }
  return NextResponse.json({ error: "The API token operation could not be completed" }, {
    status: 503,
    headers: { "cache-control": "private, no-store" }
  });
}
