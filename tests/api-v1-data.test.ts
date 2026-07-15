import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: dbMocks.query }));

import {
  getApiV1Person,
  getApiV1QualityReport,
  listApiV1People,
  listApiV1Sources
} from "@/lib/api-v1-data";
import { extractPeople, parseGedcom } from "@/lib/gedcom/parser";

const personApiId = "11111111-1111-4111-8111-111111111111";
const nextPersonApiId = "22222222-2222-4222-8222-222222222222";
const factApiId = "33333333-3333-4333-8333-333333333333";
const sourceApiId = "44444444-4444-4444-8444-444444444444";
const linkedCaseApiId = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.KINRESOLVE_API_CURSOR_SECRET = "cursor-secret-with-at-least-thirty-two-private-bytes";
});

describe("API v1 archive projections", () => {
  it("uses archive-scoped limit-plus-one people pagination and redacts internal fields", async () => {
    dbMocks.query.mockResolvedValueOnce({ rows: [
      personRow(personApiId, 1, "@I1@"),
      personRow(nextPersonApiId, 2, "person-2")
    ] });

    const result = await listApiV1People("archive-private", { limit: 1, cursor: null });

    expect(dbMocks.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE person.archive_id = $1"),
      ["archive-private", 2],
      {}
    );
    expect(result.data).toEqual([{
      id: personApiId,
      displayName: "Private Person",
      givenName: "Private",
      surname: "Person",
      sex: "U",
      birth: { date: "1900", place: "Somewhere" },
      death: {},
      livingStatus: "unknown",
      privacy: "private",
      updatedAt: "2026-07-15T00:00:00.000Z"
    }]);
    expect(JSON.stringify(result)).not.toMatch(/notes|relatives|published|slug/i);
    expect(result.page.nextCursor).toEqual(expect.any(String));
  });

  it("returns private person detail without fact source text", async () => {
    dbMocks.query
      .mockResolvedValueOnce({ rows: [personRow(personApiId, 1, "@I1@")] })
      .mockResolvedValueOnce({ rows: [{
        id: factApiId,
        fact_type: "BIRT",
        date_text: "1900",
        place_text: "Somewhere",
        value_text: null,
        privacy: "private",
        confidence: "0.8",
        source_text: "must never be selected"
      }] });

    const result = await getApiV1Person("archive-private", personApiId);

    expect(result?.facts).toEqual([{
      id: factApiId,
      type: "BIRT",
      date: "1900",
      place: "Somewhere",
      privacy: "private",
      confidence: 0.8
    }]);
    expect(dbMocks.query.mock.calls[1][0]).not.toContain("source_text");
    expect(dbMocks.query.mock.calls[1][1]).toEqual([
      "archive-private",
      "@I1@"
    ]);
    expect(JSON.stringify(result)).not.toContain("must never be selected");
  });

  it("keeps an imported xref-less Unicode NAME out of IDs, cursors, and URLs", async () => {
    const imported = extractPeople(parseGedcom(
      "0 HEAD\n1 CHAR UTF-8\n0 INDI\n1 NAME José /Müller/\n0 @I2@ INDI\n1 NAME Next /Person/\n0 TRLR"
    ).records);
    expect(imported[0]?.id).toBe("José /Müller/");
    dbMocks.query.mockResolvedValueOnce({ rows: [
      personRow(personApiId, 1, imported[0]!.id),
      personRow(nextPersonApiId, 2, imported[1]!.id)
    ] });

    const result = await listApiV1People("archive-private", { limit: 1, cursor: null });

    expect(result.data[0]?.id).toBe(personApiId);
    const cursor = result.page.nextCursor!;
    expect(cursor).toEqual(expect.any(String));
    expect(cursor).not.toContain(imported[0]!.id);
    expect(Buffer.from(cursor.split(".")[0]!, "base64url").toString("utf8"))
      .not.toContain(imported[0]!.id);
    expect(`/api/v1/people/${encodeURIComponent(result.data[0]!.id)}`)
      .not.toMatch(/Jos|M%C3%BCller|Müller/);
  });

  it("projects sources without storage, URLs, transcripts, filenames, or notes", async () => {
    dbMocks.query.mockResolvedValueOnce({ rows: [{
      id: sourceApiId,
      title: "Private register",
      source_type: "Register",
      repository: "Archive",
      citation_date: "1900",
      linked_person_id: personApiId,
      linked_case_id: linkedCaseApiId,
      privacy: "private",
      confidence: "0.9",
      created_at: new Date("2026-07-15T00:00:00.000Z"),
      sort_order: 1,
      storage_key: "secret-key",
      url: "https://private.example",
      transcript: "private body",
      notes: "private note"
    }] });

    const result = await listApiV1Sources("archive-private", { limit: 25, cursor: null });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toMatch(/secret-key|private\.example|private body|private note/);
    expect(dbMocks.query.mock.calls[0][0]).not.toMatch(/storage_key|\burl\b|transcript|notes|file_name/);
    expect(dbMocks.query.mock.calls[0][0]).toContain("source.api_id::text AS id");
    expect(result.data[0]).toMatchObject({
      id: sourceApiId,
      linkedPersonId: personApiId,
      linkedCaseId: linkedCaseApiId
    });
  });

  it("fails closed on a legacy confidence outside the public 0..1 contract", async () => {
    dbMocks.query.mockResolvedValueOnce({ rows: [{
      id: sourceApiId,
      title: "Invalid legacy confidence",
      source_type: "Register",
      repository: null,
      citation_date: null,
      linked_person_id: null,
      linked_case_id: null,
      privacy: "private",
      confidence: "1.001",
      created_at: new Date("2026-07-15T00:00:00.000Z"),
      sort_order: 1
    }] });

    await expect(listApiV1Sources("archive-private", { limit: 25, cursor: null }))
      .rejects.toThrow(/stored API confidence is invalid/i);
  });

  it("returns only aggregate quality checks", async () => {
    dbMocks.query.mockResolvedValueOnce({ rows: [{
      people: 10,
      sources: 4,
      cases: 2,
      public_living_people: 1,
      people_without_facts: 2,
      unlinked_sources: 3,
      cases_without_evidence: 1,
      cases_without_hypotheses: 1
    }] });

    const report = await getApiV1QualityReport(
      "archive-private",
      {},
      new Date("2026-07-15T00:00:00.000Z")
    );

    expect(report.summary).toEqual({ people: 10, sources: 4, cases: 2, issues: 8 });
    expect(report.checks).toHaveLength(5);
    expect(report.checks.every((check) => !("entityId" in check) && !("detail" in check))).toBe(true);
  });
});

function personRow(id: string, sortOrder: number, databaseId: string) {
  return {
    id,
    database_id: databaseId,
    display_name: "Private Person",
    given_name: "Private",
    surname: "Person",
    sex: "U",
    birth_date: "1900",
    birth_place: "Somewhere",
    death_date: null,
    death_place: null,
    living_status: "unknown",
    privacy: "private",
    updated_at: new Date("2026-07-15T00:00:00.000Z"),
    sort_order: sortOrder,
    notes: "must not escape",
    relatives: ["person-2"],
    published: false,
    slug: "private-person"
  };
}
