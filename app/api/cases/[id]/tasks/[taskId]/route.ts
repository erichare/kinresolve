import { NextResponse } from "next/server";
import type { ResearchCase } from "@/lib/models";
import { updateCaseTask } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

const taskStatuses = new Set<ResearchCase["tasks"][number]["status"]>(["todo", "doing", "done"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const body = (await request.json()) as {
    title?: string;
    status?: ResearchCase["tasks"][number]["status"];
  };

  if (body.status && !taskStatuses.has(body.status)) {
    return NextResponse.json({ error: "Invalid task status" }, { status: 400 });
  }

  try {
    const result = await updateCaseTask(id, taskId, {
      title: body.title,
      status: body.status
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Task update failed" }, { status: 404 });
  }
}
