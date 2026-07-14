import { NextResponse } from "next/server";
import { withPermission } from "@/lib/api-authorization";
import { repairGedcomRelationshipLinks } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withPermission("imports:manage", async () => {
  try {
    return NextResponse.json(await repairGedcomRelationshipLinks());
  } catch (error) {
    console.error("Relationship repair failed", error);
    return NextResponse.json({ error: "Relationship repair failed" }, { status: 500 });
  }
});
