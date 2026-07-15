import { withApiV1Token } from "@/lib/api-v1-authorization";
import { parseApiV1PageRequest } from "@/lib/api-v1-cursor";
import { listApiV1Sources } from "@/lib/api-v1-data";
import { apiV1CollectionResponse } from "@/lib/api-v1-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApiV1Token("sources:read", "/api/v1/sources", async (request, context) => {
  const page = parseApiV1PageRequest(new URL(request.url), "/api/v1/sources", context.archiveId);
  return apiV1CollectionResponse(
    await listApiV1Sources(context.archiveId, page),
    context.requestId,
    "/api/v1/sources",
    page.limit
  );
});
