import { NextResponse } from "next/server";

import { withDemoGuestCapability } from "@/lib/api-authorization";
import {
  publicDemoSessionCookieName,
  publicDemoSessionCookieOptions,
  readPublicDemoSessionToken
} from "@/lib/public-demo-session-token";
import { resetPublicDemoSession } from "@/lib/public-demo-session-store";
import { projectPublicDemoSession } from "@/lib/public-demo-session-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = withDemoGuestCapability("demo:session-control", async (request) => {
  const token = readPublicDemoSessionToken(request.headers);
  if (!token) return NextResponse.json({ error: "Demo session required" }, { status: 401 });

  try {
    const result = await resetPublicDemoSession(token);
    const response = NextResponse.json({
      session: projectPublicDemoSession(result.session),
      workspaceUrl: "/app/cases/case-mercer-march-identity?guide=1"
    });
    const expires = new Date(result.session.expiresAt);
    response.cookies.set(publicDemoSessionCookieName, result.rawToken, {
      ...publicDemoSessionCookieOptions,
      maxAge: Math.max(1, Math.floor((expires.getTime() - Date.now()) / 1000)),
      expires
    });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const resetLimit = /reset limit/i.test(message);
    const aiInProgress = /AI request is in progress/i.test(message);
    const resetConflict = /reset (?:request is stale|is already in progress|generation is stale)/i.test(message);
    return NextResponse.json({
      error: resetLimit
        ? "The demo reset limit has been reached."
        : aiInProgress || resetConflict
          ? "Wait for the curated AI request to finish, then reset the demo."
          : "The demo session could not be reset."
    }, {
      status: resetLimit || aiInProgress || resetConflict ? 409 : 503,
      headers: { "cache-control": "private, no-store" }
    });
  }
});
