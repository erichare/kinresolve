import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  caseEvidenceQueue,
  isDnaEvidence,
  isDnaResearchCase,
  searchCasesPage,
  type CaseSearchFilters,
  type EvidenceQueueItem
} from "@/lib/case-search";
import { closeDatabasePools, query } from "@/lib/db";
import { caseEvidenceQueueFromDb, searchCasesPageFromDb } from "@/lib/store/case-queries";
import { createCase, readWorkspace, type WorkspaceData } from "@/lib/workspace-store";
import { provisionTestArchive } from "@/tests/helpers/provision-test-archive";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

let storeOptions: { databaseUrl: string; archiveId: string };

beforeEach(async () => {
  if (!databaseUrl) return;
  storeOptions = { databaseUrl, archiveId: `test-cq-${randomUUID()}` };
  await provisionTestArchive(storeOptions);
});

afterEach(async () => {
  if (!databaseUrl) return;
  await query("DELETE FROM archives WHERE id = $1", [storeOptions.archiveId], { databaseUrl });
});

afterAll(async () => {
  await closeDatabasePools();
});

async function seededWorkspace(): Promise<WorkspaceData> {
  await createCase(
    {
      id: "case-cq-dna",
      title: "Bellàndi Moonwake DNA cluster",
      question: "Which Hartwell branch does the 86 cM match connect through?",
      focus: "DNA + Northstar Cove cluster",
      status: "active",
      privacy: "private",
      hypotheses: [{ id: "hyp-cq-1", statement: "Connects through the maternal Mercer line", confidence: 0.45, status: "open" }],
      evidence: [
        {
          id: "ev-cq-dna",
          title: "Shared match cluster",
          type: "DNA",
          summary: "Cluster overlaps 73% with the Northstar Cove signal_keepers list.",
          confidence: 0.8,
          linkedDnaMatchId: "dna-cq-match"
        },
        { id: "ev-cq-weak", title: "Unsourced tree hint", type: "Tree", summary: "A member tree places her in Lantern Bay.", confidence: 0.3 }
      ],
      tasks: [
        { id: "task-cq-open", title: "Request segment data", status: "todo" },
        { id: "task-cq-done", title: "Chart the cluster centroid", status: "done" }
      ]
    },
    storeOptions
  );
  await createCase(
    {
      id: "case-cq-mixed",
      title: "Northstar Cove documentary trail",
      question: "Which household records connect the two branches?",
      focus: "Parish and census records",
      status: "active",
      privacy: "private",
      hypotheses: [
        {
          id: "hyp-cq-mixed-dna",
          statement: "SECRET_CLUSTER_HYPOTHESIS_TEXT",
          confidence: 0.4,
          status: "open"
        },
        {
          id: "hyp-cq-mixed-doc",
          statement: "The city directory households describe the same family.",
          confidence: 0.6,
          status: "open"
        }
      ],
      evidence: [
        {
          id: "ev-cq-mixed-dna",
          title: "Private cluster worksheet",
          type: "  DNA analysis",
          summary: "The relationship-range worksheet is private.",
          confidence: 0.2
        },
        {
          id: "ev-cq-mixed-doc",
          title: "City directory row",
          type: "Directory",
          summary: "A documentary harbor address remains visible.",
          confidence: 0.65
        }
      ],
      tasks: [
        { id: "task-cq-mixed-dna", title: "SECRET_CLUSTER_TASK_TEXT", status: "todo" },
        { id: "task-cq-mixed-doc", title: "Check the documentary address", status: "todo" }
      ]
    },
    storeOptions
  );
  await createCase(
    {
      id: "case-cq-empty",
      title: "Ceraluna Alta parish gap",
      question: "Where are the missing 1850s registers?",
      status: "planning",
      privacy: "sensitive",
      tasks: [{ id: "task-cq-doing", title: "Email diocesan archive", status: "doing" }]
    },
    storeOptions
  );
  await createCase(
    {
      id: "case-cq-paused",
      title: "Broad Street boarding house",
      question: "Who ran the boarding house in 1926?",
      status: "paused",
      privacy: "public",
      evidence: [{ id: "ev-cq-mid", title: "Harbor roster row", type: "Roster", summary: "Lists a signal keeper with a matching surname.", confidence: 0.55 }]
    },
    storeOptions
  );
  await createCase(
    {
      id: "case-cq-resolved",
      title: "Album photograph identification",
      question: "Is the 1911 portrait Josie?",
      status: "resolved",
      privacy: "private",
      evidence: [{ id: "ev-cq-strong", title: "Studio mark", type: "Photo", summary: "The studio only operated 1908-1914.", confidence: 0.9 }]
    },
    storeOptions
  );

  return readWorkspace(storeOptions);
}

// createCase prepends, so the LATER creation gets the LOWER sort_order and
// leads the workspace load order — while ids sort the other way around. Any
// tie-break that falls back to id instead of load order diverges here.
async function seededTieWorkspace(): Promise<WorkspaceData> {
  const workspace = await seededWorkspace();

  await createCase(
    {
      id: "case-tie-a",
      title: "Identical tie title",
      question: "First created, later in load order",
      status: "active",
      evidence: [{ id: "ev-tie-solo", title: "Tie evidence A", type: "Note", summary: "Same confidence as the others.", confidence: 0.6 }]
    },
    storeOptions
  );
  await createCase(
    {
      id: "case-tie-z",
      title: "Identical tie title",
      question: "Second created, earlier in load order",
      status: "active",
      evidence: [
        { id: "ev-order-z", title: "Tie evidence Z first", type: "Note", summary: "Array order beats id order.", confidence: 0.6 },
        { id: "ev-order-a", title: "Tie evidence A second", type: "Note", summary: "Array order beats id order.", confidence: 0.6 }
      ]
    },
    storeOptions
  );

  expect(workspace).toBeDefined();
  return readWorkspace(storeOptions);
}

function toQueueProjection(item: EvidenceQueueItem) {
  return {
    id: item.id,
    caseId: item.caseId,
    caseTitle: item.caseTitle,
    title: item.title,
    type: item.type,
    summary: item.summary,
    confidence: item.confidence,
    linkedDnaMatchId: item.linkedDnaMatchId
  };
}

describeIfDatabase("SQL case search", () => {
  it("matches the in-memory implementation across filters, queries, sorts, and stats", async () => {
    const workspace = await seededWorkspace();

    const scenarios: CaseSearchFilters[] = [
      {},
      { query: "bellandi moonwake" },
      { query: "Bellàndi Moonwake" },
      { query: "ceraluna alta" },
      { query: "northstar cluster" },
      { query: "boarding 1926" },
      { query: "mercer" },
      { query: "segment" },
      { query: "dna-cq-match" },
      { query: "no-such-case-anywhere" },
      { status: "active" },
      { status: "paused" },
      { status: "resolved" },
      { privacy: "sensitive" },
      { evidence: "dna" },
      { evidence: "no_evidence" },
      { evidence: "low_confidence" },
      { sort: "title" },
      { sort: "evidence" },
      { query: "the", status: "active", sort: "evidence" },
      { evidence: "low_confidence", sort: "title" }
    ];

    for (const filters of scenarios) {
      const expected = searchCasesPage(workspace.cases, filters, { page: 1, pageSize: 50 });
      const actual = await searchCasesPageFromDb(filters, { page: 1, pageSize: 50 }, storeOptions);

      expect(actual.stats, JSON.stringify(filters)).toEqual(expected.stats);
      expect(actual.total, JSON.stringify(filters)).toBe(expected.total);
      expect(actual.pageCount, JSON.stringify(filters)).toBe(expected.pageCount);
      expect(actual.items, JSON.stringify(filters)).toEqual(expected.items);
    }
  });

  it("returns full list items including child counts and weakest confidence", async () => {
    await seededWorkspace();

    const result = await searchCasesPageFromDb({ query: "bellandi moonwake cluster" }, { page: 1, pageSize: 10 }, storeOptions);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      id: "case-cq-dna",
      title: "Bellàndi Moonwake DNA cluster",
      question: "Which Hartwell branch does the 86 cM match connect through?",
      status: "active",
      privacy: "private",
      focus: "DNA + Northstar Cove cluster",
      hypothesisCount: 1,
      evidenceCount: 2,
      dnaEvidenceCount: 1,
      taskCount: 2,
      openTaskCount: 1,
      weakestEvidenceConfidence: 0.3
    });

    const noEvidence = await searchCasesPageFromDb({ query: "missing 1850s registers" }, { page: 1, pageSize: 10 }, storeOptions);
    expect(noEvidence.items[0].weakestEvidenceConfidence).toBeUndefined();
  });

  it("excludes disabled DNA evidence and whole DNA cases from search, counts, and confidence", async () => {
    const workspace = await seededWorkspace();
    const capabilityOptions = { ...storeOptions, includeDnaEvidence: false };
    const documentaryEvidence = workspace.cases
      .filter((researchCase) => !isDnaResearchCase(researchCase))
      .flatMap((researchCase) => researchCase.evidence)
      .filter((item) => !isDnaEvidence(item));

    const hiddenMatch = await searchCasesPageFromDb(
      { query: "73%" },
      { page: 1, pageSize: 10 },
      capabilityOptions
    );
    const documentaryMatch = await searchCasesPageFromDb(
      { query: "documentary harbor address" },
      { page: 1, pageSize: 10 },
      capabilityOptions
    );
    const hiddenTypedDna = await searchCasesPageFromDb(
      { query: "relationship-range worksheet" },
      { page: 1, pageSize: 10 },
      capabilityOptions
    );
    const disabledFilter = await searchCasesPageFromDb(
      { evidence: "dna" },
      { page: 1, pageSize: 10 },
      capabilityOptions
    );
    const hiddenWholeCase = await searchCasesPageFromDb(
      { query: "bellandi moonwake cluster" },
      { page: 1, pageSize: 10 },
      capabilityOptions
    );
    const hiddenChildText = await searchCasesPageFromDb(
      { query: "secret cluster hypothesis text" },
      { page: 1, pageSize: 10 },
      capabilityOptions
    );
    const withheldDocumentaryChildText = await searchCasesPageFromDb(
      { query: "check the documentary address" },
      { page: 1, pageSize: 10 },
      capabilityOptions
    );

    expect(hiddenMatch.total).toBe(0);
    expect(hiddenTypedDna.total).toBe(0);
    expect(hiddenWholeCase.total).toBe(0);
    expect(hiddenChildText.total).toBe(0);
    expect(withheldDocumentaryChildText.total).toBe(0);
    expect(documentaryMatch.items[0]).toMatchObject({
      id: "case-cq-mixed",
      hypothesisCount: 0,
      evidenceCount: 1,
      dnaEvidenceCount: 0,
      taskCount: 0,
      openTaskCount: 0,
      weakestEvidenceConfidence: 0.65
    });
    expect(documentaryMatch.stats).toMatchObject({
      evidenceItems: documentaryEvidence.length,
      dnaEvidence: 0,
      lowConfidenceEvidence: documentaryEvidence.filter((item) => item.confidence < 0.5).length
    });
    expect(disabledFilter.total).toBe(
      workspace.cases.filter((researchCase) => !isDnaResearchCase(researchCase)).length
    );
  });

  it("treats ILIKE wildcards as literals", async () => {
    const workspace = await seededWorkspace();

    for (const searchQuery of ["73%", "signal_keepers", "signal_keepersx"]) {
      const expected = searchCasesPage(workspace.cases, { query: searchQuery }, { page: 1, pageSize: 50 });
      const actual = await searchCasesPageFromDb({ query: searchQuery }, { page: 1, pageSize: 50 }, storeOptions);
      expect(actual.items.map((item) => item.id), searchQuery).toEqual(expected.items.map((item) => item.id));
    }

    const percent = await searchCasesPageFromDb({ query: "73%" }, { page: 1, pageSize: 50 }, storeOptions);
    expect(percent.items.map((item) => item.id)).toEqual(["case-cq-dna"]);

    const noMatch = await searchCasesPageFromDb({ query: "signalxkeepers" }, { page: 1, pageSize: 50 }, storeOptions);
    expect(noMatch.items).toHaveLength(0);
  });

  it("breaks sort ties by load order even when id order disagrees", async () => {
    const workspace = await seededTieWorkspace();

    for (const sort of ["status", "title", "evidence"] as const) {
      const expected = searchCasesPage(workspace.cases, { sort }, { page: 1, pageSize: 50 });
      const actual = await searchCasesPageFromDb({ sort }, { page: 1, pageSize: 50 }, storeOptions);

      expect(actual.items.map((item) => item.id), sort).toEqual(expected.items.map((item) => item.id));
    }

    const byTitle = await searchCasesPageFromDb({ query: "identical tie" }, { page: 1, pageSize: 50 }, storeOptions);
    expect(byTitle.items.map((item) => item.id)).toEqual(["case-tie-z", "case-tie-a"]);
  });

  it("clamps pagination like the in-memory implementation", async () => {
    const workspace = await seededWorkspace();

    const expected = searchCasesPage(workspace.cases, {}, { page: 99, pageSize: 2 });
    const actual = await searchCasesPageFromDb({}, { page: 99, pageSize: 2 }, storeOptions);

    expect(actual.page).toBe(expected.page);
    expect(actual.items).toEqual(expected.items);
    expect(actual.start).toBe(expected.start);
    expect(actual.end).toBe(expected.end);

    const oversized = await searchCasesPageFromDb({}, { page: 1, pageSize: 9_999 }, storeOptions);
    expect(oversized.pageSize).toBe(500);
  });
});

describeIfDatabase("SQL case evidence queue", () => {
  it("matches the in-memory queue order, fields, and limit", async () => {
    const workspace = await seededWorkspace();

    const expected = caseEvidenceQueue(workspace.cases, 50);
    const actual = await caseEvidenceQueueFromDb(storeOptions, 50);

    expect(actual.map(toQueueProjection)).toEqual(expected.map(toQueueProjection));
    expect(actual.some((item) => item.linkedDnaMatchId)).toBe(true);

    const limited = await caseEvidenceQueueFromDb(storeOptions, 2);
    expect(limited.map((item) => item.id)).toEqual(expected.slice(0, 2).map((item) => item.id));
  });

  it("excludes disabled linked-DNA evidence before projecting the queue", async () => {
    await seededWorkspace();

    const actual = await caseEvidenceQueueFromDb(
      { ...storeOptions, includeDnaEvidence: false },
      50
    );

    expect(actual.map((item) => item.id)).not.toContain("ev-cq-dna");
    expect(actual.map((item) => item.id)).not.toContain("ev-cq-weak");
    expect(actual.map((item) => item.id)).not.toContain("ev-cq-mixed-dna");
    expect(actual.map((item) => item.id)).not.toContain("ev-fictional-dna-range-overlap");
    expect(actual.map((item) => item.id)).toEqual(expect.arrayContaining([
      "ev-cq-mixed-doc",
      "ev-cq-mid",
      "ev-cq-strong"
    ]));
    expect(actual.every((item) => !isDnaEvidence(item))).toBe(true);
  });

  it("breaks confidence and case-title ties by flatten order, not id order", async () => {
    const workspace = await seededTieWorkspace();

    const expected = caseEvidenceQueue(workspace.cases, 50);
    const actual = await caseEvidenceQueueFromDb(storeOptions, 50);

    expect(actual.map(toQueueProjection)).toEqual(expected.map(toQueueProjection));

    // Same confidence, same (identical) case title: case-tie-z leads the load
    // order despite its id, and its evidence stays in array order.
    const tieIds = actual.filter((item) => item.confidence === 0.6).map((item) => item.id);
    expect(tieIds).toEqual(["ev-order-z", "ev-order-a", "ev-tie-solo"]);
  });
});
