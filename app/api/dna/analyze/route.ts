import { NextResponse } from "next/server";
import type { DnaMatch } from "@/lib/models";
import { readWorkspace, saveDnaMatch, scoreWorkspaceDnaMatches } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const workspace = await readWorkspace();
  return NextResponse.json(scoreWorkspaceDnaMatches(workspace));
}

export async function POST(request: Request) {
  const match = (await request.json()) as DnaMatch;

  try {
    const result = await saveDnaMatch(match);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "displayName and numeric totalCm are required" }, { status: 400 });
  }
}
