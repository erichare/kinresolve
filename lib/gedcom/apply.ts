import type { AppliedGedcomImport, RawGedcomRecord, SourceDocument } from "../models";
import { extractPeople, findChild, findChildren, parseGedcom, slugify, summarizeGedcom, textWithContinuations, type GedcomRecord } from "./parser";
import { stableHash, type ImportSnapshot } from "./importer";

export type PreparedGedcomImport = {
  snapshot: ImportSnapshot;
  appliedImport: Omit<AppliedGedcomImport, "backupId">;
  people: ReturnType<typeof extractPeople>;
  sources: SourceDocument[];
  rawRecords: RawGedcomRecord[];
};

export function prepareGedcomImport(sourceName: string, content: string, appliedAt = new Date()): PreparedGedcomImport {
  const parsed = parseGedcom(content);
  const snapshot = createSnapshotFromParsed(sourceName, content, parsed.records);
  const rawRecords = snapshot.records.map((record) => ({
    id: rawRecordId(snapshot.id, record.type, record.xref, record.checksum),
    importId: snapshot.id,
    xref: record.xref,
    type: record.type,
    checksum: record.checksum,
    raw: record.raw
  }));
  const rawRecordByXref = new Map(rawRecords.filter((record) => record.xref).map((record) => [record.xref, record]));
  const sources = extractSourceDocuments(parsed.records, snapshot.id, rawRecordByXref, appliedAt);
  const people = extractPeople(parsed.records);

  return {
    snapshot,
    appliedImport: {
      id: snapshot.id,
      sourceName: snapshot.sourceName,
      checksum: snapshot.checksum,
      appliedAt: appliedAt.toISOString(),
      summary: snapshot.summary,
      recordCount: snapshot.records.length,
      peopleImported: people.length,
      sourcesImported: sources.length,
      rawRecordCount: rawRecords.length
    },
    people,
    sources,
    rawRecords
  };
}

function createSnapshotFromParsed(sourceName: string, content: string, records: GedcomRecord[]): ImportSnapshot {
  return {
    id: `import-${stableHash(`${sourceName}:${content}`).slice(0, 12)}`,
    sourceName,
    checksum: stableHash(content),
    summary: summarizeGedcom(records),
    records: records.map((record) => ({
      xref: record.xref,
      type: record.type,
      checksum: stableHash(record.raw),
      raw: record.raw
    }))
  };
}

function extractSourceDocuments(records: GedcomRecord[], importId: string, rawRecordByXref: Map<string | undefined, RawGedcomRecord>, createdAt: Date): SourceDocument[] {
  return records
    .filter((record) => record.type === "SOUR")
    .map((record) => {
      const title =
        textWithContinuations(findChild(record.root, "TITL")) ??
        textWithContinuations(findChild(record.root, "ABBR")) ??
        record.root.value ??
        record.xref ??
        "Untitled GEDCOM source";
      const repository = findChild(record.root, "REPO")?.value;
      const url = findChild(record.root, "WWW")?.value;
      const ancestryApid = findChild(record.root, "_APID")?.value;
      const notes = findChildren(record.root, "NOTE").map(textWithContinuations).filter(Boolean).join("\n\n") || undefined;
      const rawRecord = rawRecordByXref.get(record.xref);

      return {
        id: `src-gedcom-${slugify(record.xref ?? title)}`,
        title,
        sourceType: "GEDCOM source",
        importId,
        rawRecordId: rawRecord?.id,
        repository,
        url,
        ancestryApid,
        transcript: notes,
        privacy: "private",
        confidence: 0.65,
        createdAt: createdAt.toISOString()
      };
    });
}

function rawRecordId(importId: string, type: string, xref: string | undefined, checksum: string): string {
  return `raw-${importId}-${slugify(`${type}-${xref ?? checksum}`)}`;
}
