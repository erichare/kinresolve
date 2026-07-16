import { NextResponse } from "next/server";

import { withDemoGuestCapability } from "@/lib/api-authorization";
import { workspaceOptionsForSession } from "@/lib/auth-session";
import { publicDemoGuidedCaseId } from "@/lib/public-demo-contract";
import { readPublicDemoSessionToken } from "@/lib/public-demo-session-token";
import { readPublicDemoSession } from "@/lib/public-demo-session-store";
import { projectPublicDemoSession } from "@/lib/public-demo-session-response";
import { readResearchCase } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withDemoGuestCapability("demo:session-control", async (request, guest) => {
  const token = readPublicDemoSessionToken(request.headers);
  const session = token ? await readPublicDemoSession(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Demo session required" }, { status: 401 });
  }
  const researchCase = await readResearchCase(
    publicDemoGuidedCaseId,
    workspaceOptionsForSession(guest)
  );
  const task = researchCase?.tasks.find(({ id }) => id === "task-compare-signatures");
  const latestOutcome = task?.outcomes?.at(-1);

  return NextResponse.json({
    session: projectPublicDemoSession(session),
    progress: {
      guidedOutcome: latestOutcome?.type ?? null,
      guidedOutcomeCompleted: Boolean(latestOutcome),
      guidedTaskStatus: task?.status ?? "unavailable"
    },
    workspaceUrl: "/app/cases/case-mercer-march-identity?guide=1"
  }, { headers: privateHeaders() });
});

function privateHeaders(): HeadersInit {
  return {
    "cache-control": "private, no-store",
    "x-robots-tag": "noindex, nofollow, noarchive"
  };
}
