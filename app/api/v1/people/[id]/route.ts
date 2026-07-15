import { withApiV1Token } from "@/lib/api-v1-authorization";
import { isApiV1ResourceId } from "@/lib/api-v1-contract";
import { getApiV1Person } from "@/lib/api-v1-data";
import { apiV1ErrorResponse, apiV1JsonResponse } from "@/lib/api-v1-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PersonRouteContext = {
  params: Promise<{ id: string }>;
};

export const GET = withApiV1Token(
  "archive:read",
  "/api/v1/people/[id]",
  async (_request, context, route: PersonRouteContext) => {
    const { id } = await route.params;
    if (!isApiV1ResourceId(id)) {
      return apiV1ErrorResponse(404, "not_found", "Not found", context.requestId);
    }
    const person = await getApiV1Person(context.archiveId, id);
    return person
      ? apiV1JsonResponse({ data: person }, context.requestId)
      : apiV1ErrorResponse(404, "not_found", "Not found", context.requestId);
  }
);
