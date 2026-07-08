import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractPeople, parseGedcom, textWithContinuations } from "@/lib/gedcom/parser";

describe("GEDCOM parser", () => {
  it("parses synthetic GEDCOM records and summary counts", () => {
    const content = readFileSync("fixtures/synthetic-family.ged", "utf8");
    const parsed = parseGedcom(content);

    expect(parsed.summary.individuals).toBe(3);
    expect(parsed.summary.families).toBe(2);
    expect(parsed.summary.sources).toBe(1);
    expect(parsed.summary.media).toBe(1);
    expect(parsed.summary.dateRange?.minYear).toBe(1858);
    expect(parsed.summary.dateRange?.maxYear).toBe(1961);
  });

  it("extracts people, events, places, relationships, and notes", () => {
    const content = readFileSync("fixtures/synthetic-family.ged", "utf8");
    const people = extractPeople(parseGedcom(content).records);
    const elizabeth = people.find((person) => person.displayName === "Elizabeth Katherine Riemer");

    expect(elizabeth).toBeDefined();
    expect(elizabeth?.surname).toBe("Riemer");
    expect(elizabeth?.birthPlace).toBe("Chicago, Cook, Illinois, USA");
    expect(elizabeth?.facts.map((fact) => fact.type)).toContain("BIRT");
    expect(elizabeth?.relatives).toContain("@F1@");
    expect(elizabeth?.notes).toContain("Synthetic ancestor");
  });

  it("preserves continuation text", () => {
    const parsed = parseGedcom("0 @N1@ NOTE First line\n1 CONT Second line\n1 CONC joined");
    expect(textWithContinuations(parsed.records[0].root)).toBe("First line\nSecond linejoined");
  });

  it("rejects malformed lines", () => {
    expect(() => parseGedcom("not a gedcom line")).toThrow(/Invalid GEDCOM line/);
  });
});
