import { NextResponse } from "next/server";
import { buildQualityReport } from "@/lib/quality";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const workspace = await readWorkspace();
  return NextResponse.json(buildQualityReport(workspace.people, workspace.dnaMatches, workspace.cases));
}
