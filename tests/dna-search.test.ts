import { describe, expect, it } from "vitest";
import type { DnaMatch } from "@/lib/models";
import { filterDnaMatches, helpfulnessBucket, paginateDnaMatches, type ScoredDnaMatch } from "@/lib/dna-search";

const matches: ScoredDnaMatch[] = [
  scored(
    {
      id: "dna-fletcher",
      displayName: "J. Fletcher",
      totalCm: 238,
      predictedRelationship: "likely 2C1R",
      side: "maternal",
      treeStatus: "partial",
      surnames: ["Fletcher", "Riemer"],
      places: ["Chicago", "Limerick"],
      sharedMatches: ["A. Zajicek"],
      notes: "Partial tree with Chicago overlap.",
      triageStatus: "high_priority"
    },
    92
  ),
  scored(
    {
      id: "dna-collins",
      displayName: "L. Collins",
      totalCm: 118,
      predictedRelationship: "likely 3C",
      side: "paternal",
      treeStatus: "none",
      surnames: [],
      places: ["Cornwall"],
      sharedMatches: [],
      notes: "",
      triageStatus: "needs_review"
    },
    39
  ),
  scored(
    {
      id: "dna-zajicek",
      displayName: "A. Zajicek",
      totalCm: 198,
      predictedRelationship: "likely 2C2R",
      side: "maternal",
      treeStatus: "public",
      surnames: ["Zajicek"],
      places: ["Cook County"],
      sharedMatches: ["J. Fletcher"],
      notes: "Public tree.",
      triageStatus: "triaged"
    },
    88
  )
];

describe("DNA match search", () => {
  it("searches match names, surnames, places, and notes", () => {
    expect(filterDnaMatches(matches, { query: "riemer chicago" }).map((match) => match.id)).toEqual(["dna-fletcher"]);
    expect(filterDnaMatches(matches, { query: "cornwall" }).map((match) => match.id)).toEqual(["dna-collins"]);
  });

  it("filters by side, tree status, triage status, and helpfulness", () => {
    expect(filterDnaMatches(matches, { side: "maternal" }).map((match) => match.id)).toEqual(["dna-fletcher", "dna-zajicek"]);
    expect(filterDnaMatches(matches, { treeStatus: "none" }).map((match) => match.id)).toEqual(["dna-collins"]);
    expect(filterDnaMatches(matches, { status: "triaged" }).map((match) => match.id)).toEqual(["dna-zajicek"]);
    expect(filterDnaMatches(matches, { helpfulness: "low" }).map((match) => match.id)).toEqual(["dna-collins"]);
  });

  it("sorts by helpfulness by default and paginates safely", () => {
    const filtered = filterDnaMatches(matches);
    const page = paginateDnaMatches(filtered, 3, 2);

    expect(filtered.map((match) => match.id)).toEqual(["dna-fletcher", "dna-zajicek", "dna-collins"]);
    expect(page.page).toBe(2);
    expect(page.items.map((match) => match.id)).toEqual(["dna-collins"]);
  });

  it("buckets helpfulness scores", () => {
    expect(helpfulnessBucket(82)).toBe("high");
    expect(helpfulnessBucket(55)).toBe("medium");
    expect(helpfulnessBucket(12)).toBe("low");
  });
});

function scored(match: Omit<DnaMatch, "longestSegmentCm">, helpfulnessScore: number): ScoredDnaMatch {
  return { ...match, helpfulnessScore };
}
