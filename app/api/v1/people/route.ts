import { withApiV1Token } from "@/lib/api-v1-authorization";
import { parseApiV1PageRequest } from "@/lib/api-v1-cursor";
import { listApiV1People } from "@/lib/api-v1-data";
import { apiV1CollectionResponse } from "@/lib/api-v1-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApiV1Token("archive:read", "/api/v1/people", async (request, context) => {
  const page = parseApiV1PageRequest(new URL(request.url), "/api/v1/people", context.archiveId);
  return apiV1CollectionResponse(
    await listApiV1People(context.archiveId, page),
    context.requestId,
    "/api/v1/people",
    page.limit
  );
});
