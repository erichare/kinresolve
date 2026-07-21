import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({
  externalAIPolicyVersion: "hosted-external-ai-v1",
  runAIAnalysis: vi.fn()
}));
const workspaceMocks = vi.hoisted(() => ({
  createWorkspaceDnaHypotheses: vi.fn(),
  readWorkspace: vi.fn(),
  saveAIAnalysisRun: vi.fn()
}));
const rateLimitMocks = vi.hoisted(() => ({
  consumeDurableAuthRateLimit: vi.fn()
}));

vi.mock("@/lib/ai", () => aiMocks);
vi.mock("@/lib/workspace-store", () => workspaceMocks);
vi.mock("@/lib/durable-auth-rate-limit", () => rateLimitMocks);
vi.mock("@/lib/auth-session", () => ({
  getSessionContext: vi.fn(async () => ({
    userId: "owner-1",
    email: "owner@example.test",
    name: "Owner",
    role: "owner",
    archiveId: "archive-pilot"
  }))
}));

import { POST } from "@/app/api/ai/analyze/route";

beforeEach(() => {
  vi.clearAllMocks();
  stubHostedPrivateBeta();
  vi.stubEnv("AI_API_KEY", "stray-provider-key");
  vi.stubEnv("KINRESOLVE_BETA_PRIVACY_HMAC_SECRET", "separate-test-hmac-secret-at-least-32-bytes");
  rateLimitMocks.consumeDurableAuthRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 11,
    retryAfterSeconds: 0
  });
  workspaceMocks.readWorkspace.mockResolvedValue({
    people: [{ id: "person-1" }],
    cases: [{ id: "case-1" }],
    sources: [{ id: "source-1" }],
    dnaMatches: [{ id: "dna-private" }]
  });
  workspaceMocks.createWorkspaceDnaHypotheses.mockReturnValue([{ matchId: "dna-private" }]);
  aiMocks.runAIAnalysis.mockResolvedValue({
    answer: "Recommendation: review the cited source.",
    status: "ready",
    evidenceUsed: [],
    uncertainty: [],
    anomalies: [],
    suggestions: [],
    contextReferences: [],
    provider: "local",
    model: "deterministic",
    providerStatus: "not_configured",
    promptPreview: "Local checks"
  });
  workspaceMocks.saveAIAnalysisRun.mockResolvedValue({ id: "run-1" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hosted AI analysis route capabilities", () => {
  it("omits DNA and strips provider credentials while preserving local analysis", async () => {
    const response = await POST(new Request("https://app.kinresolve.com/api/ai/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "Which source should I verify?", caseId: "case-1" })
    }));

    expect(response.status).toBe(200);
    expect(aiMocks.runAIAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      dnaMatches: [],
      dnaHypotheses: [],
      provider: expect.objectContaining({ apiKey: undefined })
    }));
    expect(workspaceMocks.createWorkspaceDnaHypotheses).not.toHaveBeenCalled();
    expect(workspaceMocks.readWorkspace).toHaveBeenCalledWith({ archiveId: "archive-pilot" });
    expect(workspaceMocks.saveAIAnalysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ready",
        providerStatus: "not_configured",
        provider: "local",
        model: "deterministic"
      }),
      { archiveId: "archive-pilot" }
    );
    await expect(response.json()).resolves.toMatchObject({
      status: "ready",
      providerStatus: "not_configured",
      provider: "local",
      model: "deterministic"
    });
  });

  it("requires explicit per-run confirmation before external AI is called", async () => {
    vi.stubEnv("KINRESOLVE_EXTERNAL_AI_ENABLED", "true");

    const denied = await POST(new Request("https://app.kinresolve.com/api/ai/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "Which source should I verify?", caseId: "case-1" })
    }));

    expect(denied.status).toBe(400);
    await expect(denied.json()).resolves.toMatchObject({ error: expect.stringMatching(/confirm.*external AI/i) });
    expect(workspaceMocks.readWorkspace).not.toHaveBeenCalled();
    expect(aiMocks.runAIAnalysis).not.toHaveBeenCalled();

    const allowed = await POST(new Request("https://app.kinresolve.com/api/ai/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "Which source should I verify?",
        caseId: "case-1",
        externalProviderConsent: true
      })
    }));

    expect(allowed.status).toBe(200);
    expect(aiMocks.runAIAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      externalProviderConsent: true,
      provider: expect.objectContaining({ apiKey: "stray-provider-key" })
    }));
    expect(rateLimitMocks.consumeDurableAuthRateLimit).toHaveBeenCalledTimes(2);
    expect(rateLimitMocks.consumeDurableAuthRateLimit).toHaveBeenNthCalledWith(1, expect.objectContaining({
      maximumRequests: 12,
      scope: "ai:provider:hour",
      subject: "archive-pilot:owner-1",
      windowSeconds: 3_600
    }));
    expect(rateLimitMocks.consumeDurableAuthRateLimit).toHaveBeenNthCalledWith(2, expect.objectContaining({
      maximumRequests: 40,
      scope: "ai:provider:day",
      subject: "archive-pilot:owner-1",
      windowSeconds: 86_400
    }));
    expect(workspaceMocks.saveAIAnalysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedBy: "owner-1",
        providerConsentVersion: "hosted-external-ai-v1"
      }),
      { archiveId: "archive-pilot" }
    );
  });

  it("requires a valid case after consent before external AI is called", async () => {
    vi.stubEnv("KINRESOLVE_EXTERNAL_AI_ENABLED", "true");

    const response = await POST(new Request("https://app.kinresolve.com/api/ai/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "Review the archive generally.",
        externalProviderConsent: true
      })
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/choose a research case/i) });
    expect(aiMocks.runAIAnalysis).not.toHaveBeenCalled();
    expect(rateLimitMocks.consumeDurableAuthRateLimit).not.toHaveBeenCalled();
  });

  it("enforces a durable hosted provider quota before making the external call", async () => {
    vi.stubEnv("KINRESOLVE_EXTERNAL_AI_ENABLED", "true");
    rateLimitMocks.consumeDurableAuthRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 733
    });

    const response = await POST(new Request("https://app.kinresolve.com/api/ai/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "Which source should I verify?",
        caseId: "case-1",
        externalProviderConsent: true
      })
    }));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("733");
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/request limit/i) });
    expect(aiMocks.runAIAnalysis).not.toHaveBeenCalled();
    expect(workspaceMocks.saveAIAnalysisRun).not.toHaveBeenCalled();
  });
});

function stubHostedPrivateBeta() {
  const environment = {
    KINRESOLVE_DEPLOYMENT_MODE: "hosted",
    KINRESOLVE_DATASET_MODE: "pilot",
    KINRESOLVE_DNA_ENABLED: "false",
    KINRESOLVE_EXTERNAL_AI_ENABLED: "false",
    KINRESOLVE_PUBLIC_ARCHIVE_ENABLED: "false",
    KINRESOLVE_PUBLIC_PUBLISHING_ENABLED: "false",
    KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED: "false",
    KINRESOLVE_PACKAGE_MEDIA_ENABLED: "false",
    KINRESOLVE_PLAIN_GEDCOM_ENABLED: "true"
  } as const;
  for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
}
