import { NextResponse } from "next/server";
import { z } from "zod";

import { clientAddressRateLimitSubject } from "@/lib/auth-rate-limit-subject";
import { resolvePublicDemoConfiguration } from "@/lib/public-demo-config";
import { publicDemoNoticeVersion } from "@/lib/public-demo-contract";
import {
  publicDemoSessionCookieName,
  publicDemoSessionCookieOptions,
  readPublicDemoSessionToken
} from "@/lib/public-demo-session-token";
import { startPublicDemoSession } from "@/lib/public-demo-session-store";
import { derivePublicDemoNetworkDigest } from "@/lib/public-demo-rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const startSchema = z.object({
  noticeVersion: z.literal(publicDemoNoticeVersion)
}).strict();

export async function POST(request: Request) {
  try {
    if (!resolvePublicDemoConfiguration().enabled) return notFound();
    const parsed = startSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "The current public demo notice must be accepted." }, { status: 400 });
    }

    const result = await startPublicDemoSession({
      rawToken: readPublicDemoSessionToken(request.headers) ?? undefined,
      noticeVersion: parsed.data.noticeVersion,
      networkSubjectDigest: derivePublicDemoNetworkDigest(clientAddressRateLimitSubject(request))
    });
    if (result.kind === "rate-limited") {
      return NextResponse.json({
        error: "Too many public demo sessions were started from this network.",
        familyUrl: "/family",
        challengeUrl: "/challenge"
      }, {
        status: 429,
        headers: {
          "cache-control": "private, no-store",
          "retry-after": String(result.retryAfterSeconds)
        }
      });
    }
    if (result.kind === "capacity-exceeded") {
      return NextResponse.json({
        error: "The public demo is at capacity. Please try again shortly.",
        maximumActiveSessions: result.maximumActiveSessions,
        familyUrl: "/family",
        challengeUrl: "/challenge"
      }, {
        status: 429,
        headers: { "cache-control": "private, no-store", "retry-after": "300" }
      });
    }

    const response = NextResponse.json({
      resumed: result.kind === "resumed",
      session: result.session,
      workspaceUrl: "/app/cases/case-mercer-march-identity?guide=1",
      caseTitle: "The Mercer–March passenger mystery"
    }, { status: result.kind === "created" ? 201 : 200 });
    setSessionCookie(response, result.rawToken, result.session.expiresAt);
    return response;
  } catch {
    return NextResponse.json({ error: "The public demo session could not be started." }, {
      status: 503,
      headers: { "cache-control": "private, no-store", "retry-after": "60" }
    });
  }
}

function setSessionCookie(response: NextResponse, rawToken: string, expiresAt: string): void {
  const expires = new Date(expiresAt);
  const remaining = Math.max(1, Math.floor((expires.getTime() - Date.now()) / 1000));
  response.cookies.set(publicDemoSessionCookieName, rawToken, {
    ...publicDemoSessionCookieOptions,
    maxAge: Math.min(publicDemoSessionCookieOptions.maxAge, remaining),
    expires
  });
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("x-robots-tag", "noindex, nofollow, noarchive");
}

function notFound(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
