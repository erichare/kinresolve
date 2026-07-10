import { describe, expect, it } from "vitest";
import { createImportSnapshot, diffImportSnapshots } from "@/lib/gedcom/importer";

describe("import snapshots", () => {
  it("creates stable snapshot summaries", () => {
    const snapshot = createImportSnapshot("demo.ged", "0 HEAD\n0 @I1@ INDI\n1 NAME Test /Person/\n0 TRLR");

    expect(snapshot.records).toHaveLength(3);
    expect(snapshot.summary.individuals).toBe(1);
    expect(snapshot.checksum).toMatch(/[a-f0-9]{8}/);
  });

  it("detects added, changed, deleted, and unchanged records", () => {
    const previous = createImportSnapshot("previous.ged", "0 HEAD\n0 @I1@ INDI\n1 NAME Test /Person/\n0 @I2@ INDI\n1 NAME Gone /Person/\n0 TRLR");
    const next = createImportSnapshot("next.ged", "0 HEAD\n0 @I1@ INDI\n1 NAME Test /Changed/\n0 @I3@ INDI\n1 NAME New /Person/\n0 TRLR");
    const diff = diffImportSnapshots(previous, next);

    expect(diff.changed).toBe(1);
    expect(diff.added).toBe(1);
    expect(diff.deleted).toBe(1);
    expect(diff.unchanged).toBe(2);
  });

  it("previews a GEDCOM larger than the Vercel request limit", () => {
    const personCount = 65_000;
    const note = "x".repeat(96);
    const content = Array.from({ length: personCount }, (_, index) => (
      `0 @I${index}@ INDI\n1 NAME Person ${index} /Loadtest/\n1 BIRT\n2 DATE 1 JAN ${1800 + (index % 200)}\n1 NOTE ${note}`
    )).join("\n");

    expect(Buffer.byteLength(content)).toBeGreaterThan(10.5 * 1024 * 1024);
    const snapshot = createImportSnapshot("large-family.ged", content);

    expect(snapshot.records).toHaveLength(personCount);
    expect(snapshot.summary.individuals).toBe(personCount);
    expect(snapshot.summary.dateRange).toEqual({ minYear: 1800, maxYear: 1999 });
  }, 20_000);
});
