import { describe, expect, it } from "vitest";
import { findStructuredAnomalies, runAIAnalysis } from "@/lib/ai";
import { demoCases, demoDnaHypotheses, demoPeople } from "@/lib/demo-data";

describe("AI analysis", () => {
  it("finds structured anomalies without an AI provider", () => {
    const anomalies = findStructuredAnomalies([
      {
        ...demoPeople[0],
        deathDate: "1800",
        birthDate: "1900"
      }
    ]);

    expect(anomalies.some((anomaly) => anomaly.type === "date_conflict")).toBe(true);
  });

  it("requires owner/admin role for whole-tree analysis", async () => {
    await expect(
      runAIAnalysis({
        role: "viewer",
        question: "What connects this branch?",
        people: demoPeople,
        cases: demoCases,
        dnaHypotheses: demoDnaHypotheses,
        provider: {
          baseUrl: "https://api.openai.com/v1",
          chatModel: "gpt-5-mini",
          embeddingModel: "text-embedding-3-small"
        }
      })
    ).rejects.toThrow(/cannot perform/);
  });

  it("returns configuration_required when API key is absent", async () => {
    const result = await runAIAnalysis({
      role: "owner",
      question: "What connects this branch?",
      people: demoPeople,
      cases: demoCases,
      dnaHypotheses: demoDnaHypotheses,
      provider: {
        baseUrl: "https://api.openai.com/v1",
        chatModel: "gpt-5-mini",
        embeddingModel: "text-embedding-3-small"
      }
    });

    expect(result.status).toBe("configuration_required");
    expect(result.evidenceUsed).toContain("3 people");
  });
});

