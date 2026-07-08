import { NextResponse } from "next/server";
import { createDnaConnectionHypothesis, scoreDnaMatch } from "@/lib/dna";
import { demoPeople } from "@/lib/demo-data";
import type { DnaMatch } from "@/lib/models";

export async function POST(request: Request) {
  const match = (await request.json()) as DnaMatch;

  if (!match.displayName || typeof match.totalCm !== "number") {
    return NextResponse.json({ error: "displayName and numeric totalCm are required" }, { status: 400 });
  }

  return NextResponse.json({
    helpfulnessScore: scoreDnaMatch(match),
    hypothesis: createDnaConnectionHypothesis(match, demoPeople)
  });
}

