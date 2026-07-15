import { NextResponse } from "next/server";

import { withPermission } from "@/lib/api-authorization";
import { BetaApiTokenError, revokeApiTokenForOwner } from "@/lib/beta-api-tokens";
import { emitOperationalEvent } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TokenRouteContext = {
  params: Promise<{ id: string }>;
};

export const DELETE = withPermission("api-tokens:manage", async (
  _request,
  context,
  route: TokenRouteContext
) => {
    const { id } = await route.params;
    try {
      const token = await revokeApiTokenForOwner({
        archiveId: context.archiveId,
        userId: context.userId,
        tokenId: id,
        requestId: context.requestId
      });
      await emitOperationalEvent({
        event: "api_token_revoked",
        severity: "info",
        requestId: context.requestId,
        route: "/api/settings/api-tokens/[id]",
        tokenId: token.id
      });
      return NextResponse.json({
        id: token.id,
        revokedAt: token.revokedAt?.toISOString() ?? null
      }, { headers: { "cache-control": "private, no-store" } });
    } catch (error) {
      if (error instanceof BetaApiTokenError) {
        const status = error.code === "API_DISABLED"
          ? 404
          : error.code === "FORBIDDEN"
            ? 403
            : error.code === "INVALID_INPUT"
              ? 400
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
});
