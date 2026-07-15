import { beforeEach, describe, expect, it, vi } from "vitest";

import { runAIAnalysis } from "@/lib/ai";
import type { ResearchCase } from "@/lib/models";

const researchCase: ResearchCase = {
  id: "case-documentary-ai",
  title: "Documentary identity",
  question: "Do the parish households describe the same family?",
  status: "active",
  focus: "Parish records",
  privacy: "private",
  evidence: [
    {
      id: "ev-ai-hidden",
      title: "Private cluster estimate",
      type: "DNA analysis",
      summary: "SECRET_RELATIONSHIP_RANGE",
      confidence: 0.2
    },
    {
      id: "ev-ai-documentary",
      title: "Parish register",
      type: "Vital record",
      summary: "VISIBLE_DOCUMENTARY_SUMMARY",
      confidence: 0.8
    }
  ],
  hypotheses: [
    {
      id: "hyp-dna-ai-hidden",
      statement: "SECRET_CLUSTER_HYPOTHESIS",
      confidence: 0.4,
      status: "open",
      decisions: [],
      updatedAt: "2026-07-13T17:30:00.000Z"
    },
    {
      id: "hyp-ai-documentary",
      statement: "VISIBLE_DOCUMENTARY_HYPOTHESIS",
      confidence: 0.6,
      status: "open",
      decisions: [],
      updatedAt: "2026-07-13T17:30:00.000Z"
    }
  ],
  tasks: [
    {
      id: "task-dna-ai-hidden",
      title: "SECRET_CLUSTER_TASK",
      status: "done",
      guidance: "Use the hidden DNA analysis.",
      targetHypothesisId: "hyp-dna-ai-hidden",
      contextRefs: [{ type: "evidence", id: "ev-ai-hidden" }],
      outcomes: [
        {
          id: "outcome-ai-hidden",
          requestId: "request-ai-hidden",
          type: "found",
          note: "SECRET_CLUSTER_OUTCOME",
          actorId: "owner-ai",
          actorName: "Owner",
          createdAt: "2026-07-13T18:00:00.000Z"
        }
      ]
    },
    {
      id: "task-ai-documentary",
      title: "VISIBLE_DOCUMENTARY_TASK",
      status: "todo",
      targetHypothesisId: "hyp-ai-documentary",
      contextRefs: [{ type: "evidence", id: "ev-ai-documentary" }],
      outcomes: []
    }
  ]
};

const wholeDnaCase: ResearchCase = {
  ...researchCase,
  id: "case-secret-dna-cluster",
  title: "SECRET_WHOLE_DNA_CASE_TITLE",
  question: "Does SECRET_WHOLE_DNA_CASE_QUESTION explain this cluster?",
  focus: "SECRET_WHOLE_DNA_CASE_FOCUS"
};

beforeEach(() => {
  vi.unstubAllEnvs();
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
  for (const [name, value] of Object.entries(environment)) {
    vi.stubEnv(name, value);
  }
});

describe("local analysis case capability projection", () => {
  it("omits DNA-derived evidence, hypotheses, tasks, outcomes, and references", async () => {
    const fetcher = vi.fn();
    const result = await runAIAnalysis({
      role: "owner",
      question: "What documentary work should happen next?",
      selectedCaseId: researchCase.id,
      people: [],
      cases: [researchCase, wholeDnaCase],
      sources: [],
      dnaMatches: [],
      dnaHypotheses: [],
      provider: {
        baseUrl: "https://provider.invalid/v1",
        chatModel: "unused",
        embeddingModel: "unused",
        fetcher
      }
    });
    const serialized = JSON.stringify(result);

    expect(result.provider).toBe("local");
    expect(fetcher).not.toHaveBeenCalled();
    expect(serialized).not.toMatch(
      /SECRET_CLUSTER|ev-ai-hidden|hyp-dna-ai-hidden|task-dna-ai-hidden|outcome-ai-hidden/i
    );
    expect(serialized).not.toMatch(/SECRET_WHOLE_DNA_CASE/i);
    expect(serialized).toContain("VISIBLE_DOCUMENTARY_SUMMARY");
    expect(serialized).toContain("VISIBLE_DOCUMENTARY_TASK");
  });
});
