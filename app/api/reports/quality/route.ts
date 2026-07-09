import { NextResponse } from "next/server";
import { parsePositiveInteger } from "@/lib/pagination";
import { buildQualityReportPage } from "@/lib/quality";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const workspace = await readWorkspace();
  const url = new URL(request.url);

  return NextResponse.json(
    buildQualityReportPage(workspace.people, workspace.dnaMatches, workspace.cases, {
      page: parsePositiveInteger(url.searchParams.get("page"), 1),
      pageSize: parsePositiveInteger(url.searchParams.get("pageSize"), 50)
    })
  );
}
