import { withApiV1Token } from "@/lib/api-v1-authorization";
import { apiV1Headers } from "@/lib/api-v1-http";
import { recordApiTokenExportUse } from "@/lib/beta-api-tokens";
import { exportGedcom } from "@/lib/gedcom/exporter";
import { emitOperationalEvent } from "@/lib/observability";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export const GET = withApiV1Token(
  "archive:export",
  "/api/v1/exports/gedcom",
  async (_request, context) => {
    const workspace = await readWorkspace({ archiveId: context.archiveId });
    const result = exportGedcom({
      archiveName: workspace.archiveName,
      people: workspace.people,
      rawRecords: workspace.rawRecords,
      imports: workspace.imports
    });

    await recordApiTokenExportUse({
      tokenId: context.tokenId,
      archiveId: context.archiveId,
      userId: context.userId,
      requestId: context.requestId,
      routeTemplate: "/api/v1/exports/gedcom"
    });
    await emitOperationalEvent({
      event: "export_completed",
      severity: "info",
      requestId: context.requestId,
      route: "/api/v1/exports/gedcom"
    });

    return new Response(result.content, {
      status: 200,
      headers: apiV1Headers(context.requestId, {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="${result.fileName}"`
      })
    });
  }
);
