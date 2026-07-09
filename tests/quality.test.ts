import { describe, expect, it } from "vitest";
import { demoCases, demoDnaMatches, demoPeople } from "@/lib/demo-data";
import { buildQualityReport, buildQualityReportPage } from "@/lib/quality";

describe("quality reports", () => {
  it("summarizes source, DNA, and case gaps", () => {
    const report = buildQualityReport(demoPeople, demoDnaMatches, demoCases);

    expect(report.score).toBeLessThan(100);
    expect(report.summary.sourceGaps).toBeGreaterThan(0);
    expect(report.summary.dnaGaps).toBeGreaterThan(0);
    expect(report.summary.caseGaps).toBeGreaterThan(0);
    expect(report.issues[0].severity).toMatch(/high|medium/);
  });

  it("flags high-cM DNA matches without a usable tree", () => {
    const report = buildQualityReport([], [{ ...demoDnaMatches[0], treeStatus: "none", totalCm: 238 }], []);

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: "dna",
          severity: "high"
        })
      ])
    );
  });

  it("paginates issue rows while preserving report summary", () => {
    const report = buildQualityReportPage(demoPeople, demoDnaMatches, demoCases, { page: 1, pageSize: 2 });

    expect(report.issues.items).toHaveLength(2);
    expect(report.issues.total).toBeGreaterThan(2);
    expect(report.summary.sourceGaps).toBeGreaterThan(0);
  });
});
