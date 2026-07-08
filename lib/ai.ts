import type { DnaConnectionHypothesis, PersonSummary, ResearchCase, Role } from "./models";
import { assertPermission } from "./rbac";

export type AIProviderConfig = {
  baseUrl: string;
  apiKey?: string;
  chatModel: string;
  embeddingModel: string;
};

export type StructuredAnomaly = {
  type: "date_conflict" | "privacy_risk" | "missing_source" | "relationship_gap";
  title: string;
  severity: "low" | "medium" | "high";
  evidence: string[];
};

export type AIAnalysisRequest = {
  role: Role;
  question: string;
  people: PersonSummary[];
  cases: ResearchCase[];
  dnaHypotheses: DnaConnectionHypothesis[];
  provider: AIProviderConfig;
};

export type AIAnalysisResult = {
  status: "ready" | "configuration_required";
  answer: string;
  anomalies: StructuredAnomaly[];
  evidenceUsed: string[];
  uncertainty: string[];
};

export function findStructuredAnomalies(people: PersonSummary[]): StructuredAnomaly[] {
  const anomalies: StructuredAnomaly[] = [];

  for (const person of people) {
    if (person.published && person.livingStatus === "living") {
      anomalies.push({
        type: "privacy_risk",
        title: `${person.displayName} appears published while living`,
        severity: "high",
        evidence: [`livingStatus=${person.livingStatus}`, `privacy=${person.privacy}`]
      });
    }

    const birthYear = extractYear(person.birthDate);
    const deathYear = extractYear(person.deathDate);
    if (birthYear && deathYear && deathYear < birthYear) {
      anomalies.push({
        type: "date_conflict",
        title: `${person.displayName} has death before birth`,
        severity: "high",
        evidence: [`Birth ${person.birthDate}`, `Death ${person.deathDate}`]
      });
    }

    for (const fact of person.facts) {
      if (!fact.source && ["BIRT", "DEAT", "MARR"].includes(fact.type)) {
        anomalies.push({
          type: "missing_source",
          title: `${person.displayName} has unsourced ${fact.type}`,
          severity: "medium",
          evidence: [fact.date ?? "no date", fact.place ?? "no place"]
        });
      }
    }
  }

  return anomalies;
}

export async function runAIAnalysis(request: AIAnalysisRequest): Promise<AIAnalysisResult> {
  assertPermission(request.role, "ai:whole-tree");

  const anomalies = findStructuredAnomalies(request.people);
  const evidenceUsed = [
    `${request.people.length} people`,
    `${request.cases.length} cases`,
    `${request.dnaHypotheses.length} DNA hypotheses`,
    `${anomalies.length} structured anomalies`
  ];

  if (!request.provider.apiKey) {
    return {
      status: "configuration_required",
      answer:
        "AI provider is not configured yet. Structured checks are ready, and semantic analysis will run after an OpenAI-compatible API key is added in settings.",
      anomalies,
      evidenceUsed,
      uncertainty: ["No external AI call was made because AI_API_KEY is empty."]
    };
  }

  return {
    status: "ready",
    answer: buildAnalysisPrompt(request),
    anomalies,
    evidenceUsed,
    uncertainty: [
      "This result is a retrieval-grounded research aid, not proof.",
      "DNA relationship ranges overlap and require documentary corroboration."
    ]
  };
}

export function buildAnalysisPrompt(request: AIAnalysisRequest): string {
  const caseTitles = request.cases.map((researchCase) => researchCase.title).join(", ") || "no cases";
  const dnaSummary = request.dnaHypotheses
    .map((hypothesis) => `${hypothesis.likelyBranch}: ${hypothesis.candidateCommonAncestors.join(", ")}`)
    .join("; ");

  return [
    `Question: ${request.question}`,
    `Cases: ${caseTitles}`,
    `DNA hypotheses: ${dnaSummary || "none"}`,
    "Explain evidence, confidence, and uncertainty. Do not state hypotheses as facts."
  ].join("\n");
}

function extractYear(dateText?: string): number | undefined {
  const match = dateText?.match(/(\d{4})/);
  return match ? Number(match[1]) : undefined;
}

