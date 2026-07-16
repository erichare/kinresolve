import { NextResponse } from "next/server";

import { withDemoGuestCapability } from "@/lib/api-authorization";
import {
  publicDemoSessionCookieName,
  readPublicDemoSessionToken
} from "@/lib/public-demo-session-token";
import { endPublicDemoSession } from "@/lib/public-demo-session-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withDemoGuestCapability("demo:session-control", async (request) => {
  const token = readPublicDemoSessionToken(request.headers);
  if (!token) return NextResponse.json({ error: "Demo session required" }, { status: 401 });
  await endPublicDemoSession(token);
  const response = NextResponse.json({ ended: true });
  response.cookies.set(publicDemoSessionCookieName, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
    maxAge: 0
  });
  response.headers.set("cache-control", "private, no-store");
  return response;
});
