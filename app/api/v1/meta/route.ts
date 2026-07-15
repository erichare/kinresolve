import { withApiV1Token } from "@/lib/api-v1-authorization";
import { apiV1ProductVersion, getApiV1ArchiveMeta } from "@/lib/api-v1-data";
import { apiV1ErrorResponse, apiV1JsonResponse } from "@/lib/api-v1-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApiV1Token("archive:read", "/api/v1/meta", async (_request, context) => {
  const archive = await getApiV1ArchiveMeta(context.archiveId);
  if (!archive) {
    return apiV1ErrorResponse(404, "not_found", "Not found", context.requestId);
  }

  return apiV1JsonResponse({
    data: {
      apiVersion: "v1",
      productVersion: apiV1ProductVersion(),
      archive,
      capabilities: {
        people: true,
        sources: context.scopes.includes("sources:read"),
        cases: context.scopes.includes("cases:read"),
        qualityReport: context.scopes.includes("reports:read"),
        gedcomExport: context.scopes.includes("archive:export")
      }
    }
  }, context.requestId);
});
