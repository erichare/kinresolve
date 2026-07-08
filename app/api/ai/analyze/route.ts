import { NextResponse } from "next/server";
import { runAIAnalysis } from "@/lib/ai";
import { demoCases, demoDnaHypotheses, demoPeople } from "@/lib/demo-data";
import type { Role } from "@/lib/models";

export async function POST(request: Request) {
  const body = (await request.json()) as { role?: Role; question?: string };

  try {
    const result = await runAIAnalysis({
      role: body.role ?? "viewer",
      question: body.question ?? "What should I investigate next?",
      people: demoPeople,
      cases: demoCases,
      dnaHypotheses: demoDnaHypotheses,
      provider: {
        baseUrl: process.env.AI_BASE_URL ?? "https://api.openai.com/v1",
        apiKey: process.env.AI_API_KEY,
        chatModel: process.env.AI_CHAT_MODEL ?? "gpt-5-mini",
        embeddingModel: process.env.AI_EMBEDDING_MODEL ?? "text-embedding-3-small"
      }
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI analysis failed" }, { status: 403 });
  }
}

