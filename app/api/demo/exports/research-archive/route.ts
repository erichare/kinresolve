import { NextResponse } from "next/server";

import { withDemoGuestCapability } from "@/lib/api-authorization";
import { captureOperationalError } from "@/lib/observability";
import { createPublicDemoResearchArchiveExport } from "@/lib/public-demo-exports";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withDemoGuestCapability("demo:export", async (request, guest) => {
  if (new URL(request.url).search !== "") {
    return privateJson({ error: "Demo exports do not accept input" }, 400);
  }

  try {
    const workspace = await readWorkspace({
      archiveId: guest.archiveId,
      demoGuestFence: {
        generation: guest.generation,
        sessionId: guest.sessionId
      }
    });
    const result = createPublicDemoResearchArchiveExport(workspace);

    return new NextResponse(result.content, {
      status: 200,
      headers: privateHeaders({
        "content-disposition": `attachment; filename="${result.fileName}"`,
        "content-type": "application/json; charset=utf-8",
        "x-content-sha256": result.manifestDigest
      })
    });
  } catch (error) {
    if (isStaleGeneration(error)) {
      return privateJson({ error: "This demo workspace changed. Refresh and try again." }, 409);
    }
    await captureOperationalError({
      event: "api_error",
      requestId: guest.requestId,
      route: "/api/demo/exports/research-archive"
    }, error);
    return privateJson({ error: "Unable to export the fictional demo research archive." }, 500);
  }
});

function isStaleGeneration(error: unknown): boolean {
  return error instanceof Error && /stale archive generation/i.test(error.message);
}

function privateHeaders(headers: Record<string, string> = {}): Record<string, string> {
  return {
    "cache-control": "private, no-store",
    "x-robots-tag": "noindex, nofollow, noarchive",
    ...headers
  };
}

function privateJson(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: privateHeaders() });
}
