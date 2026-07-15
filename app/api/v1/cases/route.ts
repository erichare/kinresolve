import { withApiV1Token } from "@/lib/api-v1-authorization";
import { parseApiV1PageRequest } from "@/lib/api-v1-cursor";
import { listApiV1Cases } from "@/lib/api-v1-data";
import { apiV1CollectionResponse } from "@/lib/api-v1-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApiV1Token("cases:read", "/api/v1/cases", async (request, context) => {
  const page = parseApiV1PageRequest(new URL(request.url), "/api/v1/cases", context.archiveId);
  return apiV1CollectionResponse(
    await listApiV1Cases(context.archiveId, page),
    context.requestId,
    "/api/v1/cases",
    page.limit
  );
});
