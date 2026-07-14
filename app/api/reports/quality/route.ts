import { NextResponse } from "next/server";
import { withPermission } from "@/lib/api-authorization";
import { parsePositiveInteger } from "@/lib/pagination";
import { buildQualityReportPage } from "@/lib/quality";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export const GET = withPermission("archive:read-private", async (request) => {
  const workspace = await readWorkspace();
  const url = new URL(request.url);

  return NextResponse.json(
    buildQualityReportPage(workspace.people, workspace.dnaMatches, workspace.cases, {
      page: parsePositiveInteger(url.searchParams.get("page"), 1),
      pageSize: parsePositiveInteger(url.searchParams.get("pageSize"), 50)
    })
  );
});
