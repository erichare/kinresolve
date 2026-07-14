import { NextResponse } from "next/server";
import { withPermission } from "@/lib/api-authorization";
import { parsePositiveInteger } from "@/lib/pagination";
import { buildPublicationReview } from "@/lib/publishing";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export const GET = withPermission("archive:read-private", async (request) => {
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
});
