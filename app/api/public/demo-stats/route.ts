import { NextResponse } from "next/server";

import { resolvePublicDemoConfiguration } from "@/lib/public-demo-config";
import { readPublicDemoStats } from "@/lib/public-demo-session-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    if (!resolvePublicDemoConfiguration().enabled) return notFound();
    const stats = await readPublicDemoStats();

    return NextResponse.json({
      mysteriesSolved: stats.mysteriesSolved,
      since: stats.since
    }, { headers: publicStatsHeaders() });
  } catch {
    return NextResponse.json({ error: "The public demo stats are unavailable." }, {
      status: 503,
      headers: { "cache-control": "private, no-store", "retry-after": "60" }
    });
  }
}

function publicStatsHeaders(): HeadersInit {
  return {
    "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
    "access-control-allow-origin": "https://kinresolve.com",
    "x-robots-tag": "noindex, nofollow"
  };
}

function notFound(): NextResponse {
  return NextResponse.json({ error: "Not found" }, {
    status: 404,
    headers: { "cache-control": "private, no-store", "x-robots-tag": "noindex" }
  });
}
