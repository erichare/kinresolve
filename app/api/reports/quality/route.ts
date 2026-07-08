import { NextResponse } from "next/server";
import { demoCases, demoDnaMatches, demoPeople } from "@/lib/demo-data";
import { buildQualityReport } from "@/lib/quality";

export function GET() {
  return NextResponse.json(buildQualityReport(demoPeople, demoDnaMatches, demoCases));
}

