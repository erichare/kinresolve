import { NextResponse } from "next/server";
import { parsePositiveInteger } from "@/lib/pagination";
import { buildPublicationReview } from "@/lib/publishing";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const workspace = await readWorkspace();
  const url = new URL(request.url);
  const pageSize = parsePositiveInteger(url.searchParams.get("pageSize"), 50);

  return NextResponse.json(
    buildPublicationReview(workspace.people, {
      profilePage: parsePositiveInteger(url.searchParams.get("profilesPage") ?? url.searchParams.get("profilePage"), 1),
      blockerPage: parsePositiveInteger(url.searchParams.get("blockersPage") ?? url.searchParams.get("blockerPage"), 1),
      pageSize
    })
  );
}
