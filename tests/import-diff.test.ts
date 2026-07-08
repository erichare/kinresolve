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
});

