import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ getSessionContext: vi.fn() }));
const workspaceMocks = vi.hoisted(() => ({
  acceptGuideAssignment: vi.fn(),
  addCaseTask: vi.fn(),
  readResearchCase: vi.fn()
}));

vi.mock("@/lib/auth-session", () => authMocks);
vi.mock("@/lib/workspace-store", () => workspaceMocks);

import { POST as postGuideAssignment } from "@/app/api/cases/[id]/guide/assignments/route";
import { POST as postTask } from "@/app/api/cases/[id]/tasks/route";

const documentaryEvidence = {
  id: "ev-documentary",
  title: "Parish register",
  type: "Vital record",
  summary: "A documentary household entry.",
  confidence: 0.8
};
const hiddenEvidence = {
  id: "ev-hidden-analysis",
  title: "Private cluster estimate",
  type: "DNA analysis",
  summary: "A hidden relationship-range estimate.",
  confidence: 0.2
};
const documentaryHypothesis = {
  id: "hyp-documentary",
  statement: "The parish households describe the same family.",
  confidence: 0.6,
  status: "open" as const,
  decisions: [],
  updatedAt: "2026-07-13T17:30:00.000Z"
};
const hiddenHypothesis = {
  id: "hyp-dna-private",
  statement: "The private cluster connects these branches.",
  confidence: 0.4,
  status: "open" as const,
  decisions: [
    {
      id: "decision-dna-private",
      requestId: "request-dna-private",
      fromStatus: "open" as const,
      toStatus: "open" as const,
      statement: "The private cluster connects these branches.",
      reason: "The hidden analysis was reviewed.",
      contextRefs: [{ type: "evidence" as const, id: hiddenEvidence.id }],
      actorId: "owner-private",
      actorName: "Owner",
      createdAt: "2026-07-13T17:30:00.000Z"
    }
  ],
  updatedAt: "2026-07-13T17:30:00.000Z"
};
const documentaryTask = {
  id: "task-documentary",
  title: "Check the parish register",
  status: "todo" as const,
  origin: "guide" as const,
  priority: "normal" as const,
  guideKey: "guide:v1:case-capability:review:ev-documentary:reliability",
  workFingerprint: "check the parish register",
  guidance: "Compare the two documentary households.",
  targetHypothesisId: documentaryHypothesis.id,
  contextRefs: [
    { type: "case" as const, id: "case-capability" },
    { type: "hypothesis" as const, id: documentaryHypothesis.id },
    { type: "evidence" as const, id: documentaryEvidence.id }
  ],
  outcomes: [],
  createdAt: "2026-07-13T18:00:00.000Z",
  updatedAt: "2026-07-13T18:00:00.000Z"
};
const hiddenTask = {
  id: "task-dna-private",
  title: "Review the private cluster",
  status: "done" as const,
  origin: "guide" as const,
  priority: "normal" as const,
  guideKey: "guide:v1:case-capability:review:ev-hidden-analysis:reliability",
  workFingerprint: "review private cluster",
  guidance: "Use the hidden DNA analysis.",
  targetHypothesisId: hiddenHypothesis.id,
  contextRefs: [
    { type: "hypothesis" as const, id: hiddenHypothesis.id },
    { type: "evidence" as const, id: hiddenEvidence.id }
  ],
  outcomes: [],
  createdAt: "2026-07-13T16:00:00.000Z",
  updatedAt: "2026-07-13T16:30:00.000Z"
};

const storedCase = {
  id: "case-capability",
  title: "Documentary identity case",
  question: "Do the parish households describe the same family?",
  status: "active" as const,
  focus: "Parish records",
  privacy: "private" as const,
  hypotheses: [hiddenHypothesis, documentaryHypothesis],
  evidence: [hiddenEvidence, documentaryEvidence],
  tasks: [hiddenTask, documentaryTask]
};

const wholeDnaCase = {
  ...storedCase,
  id: "case-northstar-dna-cluster",
  title: "The fictional Northstar Cove DNA cluster",
  question: "Do the invented matches connect through Maeve Rowan Mercer's family?",
  focus: "Invented Mercer–Rowan DNA matches"
};

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  stubHostedPrivateBeta();
  authMocks.getSessionContext.mockResolvedValue({
    userId: "owner-private",
    email: "owner@example.test",
    name: "Owner",
    role: "owner",
    archiveId: "archive-private"
  });
  workspaceMocks.addCaseTask.mockResolvedValue({ case: storedCase, task: documentaryTask });
  workspaceMocks.readResearchCase.mockResolvedValue(storedCase);
  workspaceMocks.acceptGuideAssignment.mockResolvedValue({
    created: true,
    case: storedCase,
    task: documentaryTask
  });
});

describe("case mutation capability projection", () => {
  it("projects stored DNA state out of a task mutation response", async () => {
    const response = await postTask(
      jsonRequest("https://app.kinresolve.com/api/cases/case-capability/tasks", {
        title: documentaryTask.title
      }),
      { params: Promise.resolve({ id: storedCase.id }) }
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.case).toMatchObject({
      evidence: [documentaryEvidence],
      hypotheses: [documentaryHypothesis],
      tasks: [documentaryTask]
    });
    expect(body.task).toEqual(documentaryTask);
    expect(JSON.stringify(body)).not.toMatch(/DNA|ev-hidden-analysis|hyp-dna-private|task-dna-private/i);
  });

  it("projects stored DNA state out of a guide-assignment mutation response", async () => {
    const response = await postGuideAssignment(
      jsonRequest("https://app.kinresolve.com/api/cases/case-capability/guide/assignments", {
        guideKey: documentaryTask.guideKey
      }),
      { params: Promise.resolve({ id: storedCase.id }) }
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.case.evidence).toEqual([documentaryEvidence]);
    expect(body.case.hypotheses).toEqual([documentaryHypothesis]);
    expect(body.case.tasks).toEqual([documentaryTask]);
    expect(body.task).toEqual(documentaryTask);
    expect(JSON.stringify(body)).not.toMatch(/DNA|ev-hidden-analysis|hyp-dna-private|task-dna-private/i);
  });

  it.each([
    ["task", async () => postTask(
      jsonRequest(`https://app.kinresolve.com/api/cases/${wholeDnaCase.id}/tasks`, {
        title: documentaryTask.title
      }),
      { params: Promise.resolve({ id: wholeDnaCase.id }) }
    )],
    ["guide", async () => postGuideAssignment(
      jsonRequest(`https://app.kinresolve.com/api/cases/${wholeDnaCase.id}/guide/assignments`, {
        guideKey: documentaryTask.guideKey
      }),
      { params: Promise.resolve({ id: wholeDnaCase.id }) }
    )]
  ])("returns not found before a whole-DNA %s mutation", async (_label, invoke) => {
    workspaceMocks.readResearchCase.mockResolvedValue(wholeDnaCase);

    const response = await invoke();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expect(workspaceMocks.addCaseTask).not.toHaveBeenCalled();
    expect(workspaceMocks.acceptGuideAssignment).not.toHaveBeenCalled();
  });
});

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function stubHostedPrivateBeta(): void {
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
}
