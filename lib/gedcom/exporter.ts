import type { AppliedGedcomImport, PersonFact, PersonSummary, RawGedcomRecord } from "../models";
import { slugify } from "./parser";

export type GedcomExportInput = {
  archiveName: string;
  people: PersonSummary[];
  rawRecords: RawGedcomRecord[];
  imports: Array<Pick<AppliedGedcomImport, "id" | "appliedAt">>;
};

export type GedcomExportOptions = {
  now?: Date;
  includeCurationTags?: boolean;
};

export type GedcomExportResult = {
  content: string;
  fileName: string;
  summary: {
    records: number;
    individuals: number;
    families: number;
    sources: number;
    synthesizedPeople: number;
  };
};

// GEDCOM 5.5.1 caps physical lines at 255 characters; leave headroom for the
// level, tag, and CONC/CONT prefixes when chunking synthesized values.
const maximumValueChunkLength = 200;
const monthAbbreviations = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const recordTypeOrder = ["SUBM", "INDI", "FAM", "SOUR", "REPO", "OBJE", "NOTE"];

export function exportGedcom(input: GedcomExportInput, options: GedcomExportOptions = {}): GedcomExportResult {
  const now = options.now ?? new Date();
  const includeCurationTags = options.includeCurationTags ?? true;

  const records = dedupeRawRecords(input.rawRecords, input.imports);
  const usedXrefs = new Set(records.map((record) => record.xref).filter((xref): xref is string => Boolean(xref)));
  const peopleByXref = new Map(input.people.map((person) => [person.id, person]));

  const bodies: Array<{ type: string; text: string }> = [];
  let synthesizedPeople = 0;

  for (const record of records) {
    // Xref-less INDI records are invalid GEDCOM 5.5.1 output; skip pass-through
    // and let the synthesis loop below emit them with a generated xref instead.
    if (record.type === "INDI" && !record.xref) {
      continue;
    }
    let text = record.raw;
    if (record.type === "INDI" && record.xref) {
      // A raw INDI without a matching person (not reachable today — people and
      // raw records only diverge if a person-delete feature is added) loses its
      // stale _KS_ tags, so a re-import falls back to the conservative
      // private/unpublished defaults.
      const person = peopleByXref.get(record.xref);
      text = stripCurationTags(text);
      if (person && includeCurationTags) {
        text = `${text}\n${curationTagLines(person).join("\n")}`;
      }
    }
    bodies.push({ type: record.type, text });
  }

  const rawIndiXrefs = new Set(
    records
      .filter((record) => record.type === "INDI" && record.xref)
      .map((record) => record.xref)
  );
  for (const person of input.people) {
    if (rawIndiXrefs.has(person.id)) {
      continue;
    }
    const xref = nextAvailableXref(usedXrefs);
    bodies.push({ type: "INDI", text: synthesizeIndividual(person, xref, includeCurationTags) });
    synthesizedPeople += 1;
  }

  const submitter = findOrCreateSubmitter(bodies, usedXrefs, input.archiveName);
  const orderedBodies = sortRecordBodies(submitter.body ? [...bodies, submitter.body] : bodies);

  const lines = [...headerLines(now, submitter.xref), ...orderedBodies.map((body) => body.text), "0 TRLR"];
  const content = `${lines.join("\n")}\n`;

  return {
    content,
    fileName: `${slugify(input.archiveName) || "kinresolve"}-${isoDate(now)}.ged`,
    summary: {
      records: orderedBodies.length + 2,
      individuals: countType(orderedBodies, "INDI"),
      families: countType(orderedBodies, "FAM"),
      sources: countType(orderedBodies, "SOUR"),
      synthesizedPeople
    }
  };
}

// Keep the newest version of each xref-keyed record across imports, matching
// the last-write-wins semantics applyPreparedGedcomImport uses when merging.
function dedupeRawRecords(rawRecords: RawGedcomRecord[], imports: GedcomExportInput["imports"]): RawGedcomRecord[] {
  const appliedAtByImportId = new Map(imports.map((item) => [item.id, item.appliedAt]));
  const sorted = [...rawRecords].sort((left, right) =>
    (appliedAtByImportId.get(left.importId) ?? "").localeCompare(appliedAtByImportId.get(right.importId) ?? "")
  );

  const byKey = new Map<string, RawGedcomRecord>();
  for (const record of sorted) {
    if (record.type === "HEAD" || record.type === "TRLR") {
      continue;
    }
    const key = record.xref ? `${record.type}:${record.xref}` : `${record.type}:checksum:${record.checksum}`;
    byKey.set(key, record);
  }

  return Array.from(byKey.values());
}

function headerLines(now: Date, submitterXref: string): string[] {
  return [
    "0 HEAD",
    "1 SOUR KINSLEUTH",
    "2 NAME KinSleuth",
    `1 DATE ${gedcomDate(now)}`,
    `1 SUBM ${submitterXref}`,
    "1 GEDC",
    "2 VERS 5.5.1",
    "2 FORM LINEAGE-LINKED",
    "1 CHAR UTF-8"
  ];
}

// HEAD.SUBM is required by GEDCOM 5.5.1. Reuse an imported submitter record
// when one exists; otherwise synthesize one for the archive.
function findOrCreateSubmitter(
  bodies: ReadonlyArray<{ type: string; text: string }>,
  usedXrefs: Set<string>,
  archiveName: string
): { xref: string; body?: { type: string; text: string } } {
  const existing = bodies.find((body) => body.type === "SUBM");
  if (existing) {
    const xref = existing.text.match(/^0[ \t]+(@[^@]+@)[ \t]+SUBM/)?.[1];
    if (xref) {
      return { xref };
    }
  }

  const xref = nextAvailableXref(usedXrefs, "KSSUB");
  return {
    xref,
    body: {
      type: "SUBM",
      text: [`0 ${xref} SUBM`, ...valueLines(1, "NAME", archiveName || "KinSleuth archive")].join("\n")
    }
  };
}

function sortRecordBodies(bodies: Array<{ type: string; text: string }>): Array<{ type: string; text: string }> {
  return bodies
    .map((body, index) => ({ body, index }))
    .sort((left, right) => {
      const leftRank = typeRank(left.body.type);
      const rightRank = typeRank(right.body.type);
      return leftRank === rightRank ? left.index - right.index : leftRank - rightRank;
    })
    .map((entry) => entry.body);
}

function typeRank(type: string): number {
  const rank = recordTypeOrder.indexOf(type);
  return rank === -1 ? recordTypeOrder.length : rank;
}

function synthesizeIndividual(person: PersonSummary, xref: string, includeCurationTags: boolean): string {
  const lines = [`0 ${xref} INDI`];

  const name = person.surname
    ? `${person.givenName ?? ""} /${person.surname}/`.trim()
    : person.displayName;
  lines.push(...valueLines(1, "NAME", name));

  if (person.sex === "M" || person.sex === "F" || person.sex === "U") {
    lines.push(`1 SEX ${person.sex}`);
  }

  for (const fact of person.facts) {
    lines.push(...factLines(fact));
  }

  if (person.notes?.trim()) {
    lines.push(...valueLines(1, "NOTE", person.notes));
  }

  if (includeCurationTags) {
    lines.push(...curationTagLines(person));
  }

  return lines.join("\n");
}

function factLines(fact: PersonFact): string[] {
  const lines: string[] = [];

  if (fact.type === "EVEN") {
    lines.push("1 EVEN");
    if (fact.value?.trim()) {
      lines.push(...valueLines(2, "TYPE", fact.value));
    }
  } else if (fact.value?.trim()) {
    lines.push(...valueLines(1, fact.type, fact.value));
  } else {
    lines.push(`1 ${fact.type}`);
  }

  if (fact.date?.trim()) {
    lines.push(...valueLines(2, "DATE", fact.date));
  }
  if (fact.place?.trim()) {
    lines.push(...valueLines(2, "PLAC", fact.place));
  }
  if (fact.source?.trim()) {
    lines.push(...valueLines(2, "SOUR", fact.source));
  }

  return lines;
}

// Curation flags travel as custom _KS_ tags so a KinSleuth-to-KinSleuth
// migration round-trips privacy decisions; other tools ignore unknown tags.
function curationTagLines(person: PersonSummary): string[] {
  return [
    `1 _KS_PRIVACY ${person.privacy}`,
    `1 _KS_PUBLISHED ${person.published ? "Y" : "N"}`,
    `1 _KS_LIVING ${person.livingStatus}`
  ];
}

function stripCurationTags(recordText: string): string {
  const kept: string[] = [];
  let skippingDepth: number | undefined;

  for (const line of recordText.split("\n")) {
    const level = Number(line.match(/^[ \t]*(\d+)/)?.[1] ?? Number.NaN);
    if (skippingDepth !== undefined && Number.isFinite(level) && level > skippingDepth) {
      continue;
    }
    skippingDepth = undefined;
    if (/^[ \t]*\d+[ \t]+_KS_/.test(line)) {
      skippingDepth = Number.isFinite(level) ? level : undefined;
      continue;
    }
    kept.push(line);
  }

  return kept.join("\n");
}

// Multi-line values become CONT continuations; over-long lines are chunked
// with CONC at non-space boundaries so parsers that trim do not lose spaces.
function valueLines(level: number, tag: string, value: string): string[] {
  const lines: string[] = [];
  const segments = value.split("\n");

  segments.forEach((segment, index) => {
    const chunks = chunkValue(segment);
    chunks.forEach((chunk, chunkIndex) => {
      if (index === 0 && chunkIndex === 0) {
        lines.push(`${level} ${tag} ${chunk}`.trimEnd());
      } else if (chunkIndex === 0) {
        lines.push(`${level + 1} CONT ${chunk}`.trimEnd());
      } else {
        lines.push(`${level + 1} CONC ${chunk}`);
      }
    });
  });

  return lines;
}

function chunkValue(value: string): string[] {
  if (value.length <= maximumValueChunkLength) {
    return [value];
  }

  const chunks: string[] = [];
  let remaining = value;
  while (remaining.length > maximumValueChunkLength) {
    let splitAt = maximumValueChunkLength;
    while (splitAt > 1 && (remaining[splitAt - 1] === " " || remaining[splitAt] === " ")) {
      splitAt -= 1;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  chunks.push(remaining);
  return chunks;
}

function nextAvailableXref(usedXrefs: Set<string>, prefix = "KS"): string {
  for (let index = 1; ; index += 1) {
    const candidate = `@${prefix}${index}@`;
    if (!usedXrefs.has(candidate)) {
      usedXrefs.add(candidate);
      return candidate;
    }
  }
}

function gedcomDate(date: Date): string {
  return `${date.getUTCDate()} ${monthAbbreviations[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function countType(bodies: Array<{ type: string }>, type: string): number {
  return bodies.filter((body) => body.type === type).length;
}
