import { NextResponse } from "next/server";
import { buildPublicationPlan } from "@/lib/publishing";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const workspace = await readWorkspace();
  return NextResponse.json(buildPublicationPlan(workspace.people));
}
