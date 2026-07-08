import { NextResponse } from "next/server";
import type { ResearchCase } from "@/lib/models";
import { createCase, readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const workspace = await readWorkspace();
  return NextResponse.json(workspace.cases);
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<ResearchCase>;

  try {
    return NextResponse.json(await createCase(body), { status: 201 });
  } catch {
    return NextResponse.json({ error: "title and question are required" }, { status: 400 });
  }
}
