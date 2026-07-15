import { withApiV1Token } from "@/lib/api-v1-authorization";
import { getApiV1QualityReport } from "@/lib/api-v1-data";
import { apiV1JsonResponse } from "@/lib/api-v1-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApiV1Token(
  "reports:read",
  "/api/v1/reports/quality",
  async (_request, context) => apiV1JsonResponse({
    data: await getApiV1QualityReport(context.archiveId)
  }, context.requestId)
);
