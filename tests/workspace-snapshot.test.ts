import { describe, expect, it } from "vitest";
import { createWorkspaceSnapshot, mergeCases, mergeDnaMatches, parseWorkspaceSnapshot, snapshotCounts } from "@/lib/workspace-snapshot";
import { demoCases, scoredDnaMatches } from "@/lib/demo-data";

describe("workspace snapshots", () => {
  it("creates versioned portable snapshots with counts", () => {
    const snapshot = createWorkspaceSnapshot({
      dnaMatches: [scoredDnaMatches[0]],
      cases: [demoCases[0]],
      importPreviews: [],
      now: new Date("2026-07-08T12:00:00.000Z")
    });

    expect(snapshot.product).toBe("KinSleuth");
    expect(snapshot.version).toBe("0.3.0");
    expect(snapshot.exportedAt).toBe("2026-07-08T12:00:00.000Z");
    expect(snapshotCounts(snapshot)).toEqual({ dnaMatches: 1, cases: 1, importPreviews: 0 });
  });

  it("parses valid snapshots and rejects unrelated JSON", () => {
    const snapshot = createWorkspaceSnapshot({ dnaMatches: [], cases: [], importPreviews: [] });

    expect(parseWorkspaceSnapshot(JSON.stringify(snapshot)).product).toBe("KinSleuth");
    expect(() => parseWorkspaceSnapshot(JSON.stringify({ product: "Other" }))).toThrow(/not a KinSleuth/);
  });

  it("merges stored entities by id", () => {
    const mergedDna = mergeDnaMatches([scoredDnaMatches[0]], [{ ...scoredDnaMatches[0], helpfulnessScore: 99 }, scoredDnaMatches[1]]);
    const mergedCases = mergeCases([demoCases[0]], [{ ...demoCases[0], title: "Updated case" }, demoCases[1]]);

    expect(mergedDna).toHaveLength(2);
    expect(mergedDna[0].helpfulnessScore).toBe(99);
    expect(mergedCases).toHaveLength(2);
    expect(mergedCases[0].title).toBe("Updated case");
  });
});
