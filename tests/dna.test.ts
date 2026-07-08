import { describe, expect, it } from "vitest";
import { createDnaConnectionHypothesis, plausibleRelationships, scoreDnaMatch } from "@/lib/dna";
import { demoDnaMatches, demoPeople } from "@/lib/demo-data";

describe("DNA triage", () => {
  it("scores matches with trees, side hints, surnames, places, and shared matches higher", () => {
    const strong = scoreDnaMatch(demoDnaMatches[0]);
    const weak = scoreDnaMatch(demoDnaMatches[2]);

    expect(strong).toBeGreaterThan(weak);
    expect(strong).toBeGreaterThanOrEqual(70);
  });

  it("returns plausible relationship ranges for 238 cM", () => {
    const labels = plausibleRelationships(238).map((range) => range.label);

    expect(labels).toContain("2C");
    expect(labels).toContain("2C1R");
  });

  it("creates branch, geography, evidence, and uncertainty hypotheses", () => {
    const hypothesis = createDnaConnectionHypothesis(demoDnaMatches[0], demoPeople);

    expect(hypothesis.likelyBranch).toBe("Maternal branch");
    expect(hypothesis.geography).toContain("Chicago");
    expect(hypothesis.candidateCommonAncestors).toContain("Elizabeth Katherine Riemer");
    expect(hypothesis.evidence.length).toBeGreaterThan(3);
    expect(hypothesis.uncertainty.length).toBeGreaterThan(1);
  });
});

