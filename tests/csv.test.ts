import { describe, expect, it } from "vitest";
import { parseCsvRows, splitCsvLine } from "@/lib/csv";

describe("CSV helpers", () => {
  it("splits quoted commas and escaped quotes", () => {
    expect(splitCsvLine('"J. Fletcher","Chicago, Illinois","said ""hello"""')).toEqual([
      "J. Fletcher",
      "Chicago, Illinois",
      'said "hello"'
    ]);
  });

  it("parses rows by header", () => {
    const rows = parseCsvRows('name,total_cm,places\n"J. Fletcher",238,"Chicago, Limerick"');

    expect(rows).toEqual([
      {
        name: "J. Fletcher",
        total_cm: "238",
        places: "Chicago, Limerick"
      }
    ]);
  });
});

