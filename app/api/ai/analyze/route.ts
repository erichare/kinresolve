import { NextResponse } from "next/server";
import { z } from "zod";
import { externalAIPolicyVersion, runAIAnalysis } from "@/lib/ai";
import { withPermission } from "@/lib/api-authorization";
import { consumeDurableAuthRateLimit } from "@/lib/durable-auth-rate-limit";
import { resolveHostedCapabilities } from "@/lib/hosted-capabilities";
import { captureOperationalError } from "@/lib/observability";
import { createWorkspaceDnaHypotheses, readWorkspace, saveAIAnalysisRun } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

const analyzeSchema = z.object({
  question: z.string().trim().min(1).max(1200),
  caseId: z.string().trim().optional(),
  externalProviderConsent: z.boolean().optional()
});

export const POST = withPermission("ai:whole-tree", async (request, authorization) => {
  const parsed = analyzeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "A research question is required." }, { status: 400 });
  }

  const body = parsed.data;

  try {
    const capabilities = resolveHostedCapabilities();
    if (capabilities.externalAi && body.externalProviderConsent !== true) {
      return NextResponse.json(
        { error: "Confirm this external AI request before sending private research context." },
        { status: 400 }
      );
    }
    const archiveOptions = { archiveId: authorization.archiveId };
    const workspace = await readWorkspace(archiveOptions);
    const linkedCaseId = body.caseId && workspace.cases.some((researchCase) => researchCase.id === body.caseId) ? body.caseId : undefined;
    if (capabilities.externalAi && !linkedCaseId) {
      return NextResponse.json(
        { error: "Choose a research case before sending a privacy-minimized external AI request." },
        { status: 400 }
      );
    }
    if (capabilities.externalAi && capabilities.deploymentMode === "hosted") {
      const subject = `${authorization.archiveId}:${authorization.userId}`;
      const hmacSecret = process.env.KINRESOLVE_BETA_PRIVACY_HMAC_SECRET ?? "";
      for (const policy of [
        { maximumRequests: 12, scope: "ai:provider:hour", windowSeconds: 3_600 },
        { maximumRequests: 40, scope: "ai:provider:day", windowSeconds: 86_400 }
      ] as const) {
        const limit = await consumeDurableAuthRateLimit({ ...policy, hmacSecret, subject });
        if (!limit.allowed) {
          return NextResponse.json(
            { error: "The external AI request limit has been reached. Try again later." },
            { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } }
          );
        }
      }
    }
    const result = await runAIAnalysis({
      role: authorization.role,
      question: body.question,
      selectedCaseId: linkedCaseId,
      externalProviderConsent: body.externalProviderConsent,
      people: workspace.people,
      cases: workspace.cases,
      sources: workspace.sources,
      dnaMatches: capabilities.dna ? workspace.dnaMatches : [],
      dnaHypotheses: capabilities.dna ? createWorkspaceDnaHypotheses(workspace) : [],
      provider: {
        baseUrl: process.env.AI_BASE_URL ?? "https://api.openai.com/v1",
        apiKey: capabilities.externalAi
          ? process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY
          : undefined,
        chatModel: process.env.AI_CHAT_MODEL ?? "gpt-5-mini",
        embeddingModel: process.env.AI_EMBEDDING_MODEL ?? "text-embedding-3-small",
        mode: process.env.AI_API_MODE === "chat" ? "chat" : "responses"
      }
    });
    const run = await saveAIAnalysisRun({
      question: body.question,
      answer: result.answer,
      status: result.status,
      evidenceUsed: result.evidenceUsed,
      uncertainty: result.uncertainty,
      anomalyCount: result.anomalies.length,
      suggestions: result.suggestions,
      contextReferences: result.contextReferences,
      provider: result.provider,
      model: result.model,
      providerStatus: result.providerStatus,
      promptPreview: result.promptPreview,
      error: result.error,
      linkedCaseId,
      requestedBy: authorization.userId,
      providerConsentVersion: capabilities.externalAi ? externalAIPolicyVersion : undefined
    }, archiveOptions);

    return NextResponse.json({ ...result, run });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI analysis failed";

    if (message.startsWith("Provider returned ")) {
      return NextResponse.json({ error: message }, { status: 502 });
    }

    await captureOperationalError({
      event: "api_error",
      requestId: authorization.requestId,
      route: "/api/ai/analyze"
    }, error);
    return NextResponse.json({ error: "AI analysis failed. Check the server logs for details." }, { status: 500 });
  }
});
