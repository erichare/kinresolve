import { NextResponse } from "next/server";
import { withPermission } from "@/lib/api-authorization";
import type { DnaMatch } from "@/lib/models";
import { saveDnaMatch } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

// The old GET here shipped every scored match; paged, filtered reads now live
// at GET /api/dna/matches.

export const POST = withPermission("dna:write", async (request: Request) => {
  const match = (await request.json()) as DnaMatch;

  try {
    const result = await saveDnaMatch(match);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "displayName and numeric totalCm are required" }, { status: 400 });
  }
});
