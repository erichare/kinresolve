import { NextResponse } from "next/server";
import type { ResearchCase } from "@/lib/models";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<ResearchCase>;

  if (!body.title || !body.question) {
    return NextResponse.json({ error: "title and question are required" }, { status: 400 });
  }

  return NextResponse.json(
    {
      id: `case-${Date.now()}`,
      title: body.title,
      question: body.question,
      status: body.status ?? "active",
      privacy: "private",
      focus: body.focus ?? "",
      hypotheses: body.hypotheses ?? [],
      evidence: body.evidence ?? [],
      tasks: []
    },
    { status: 201 }
  );
}
