import type { DnaConnectionHypothesis, DnaMatch, ImportSummary, ResearchCase } from "./models";

export const workspaceStorageKeys = {
  dnaMatches: "kinsleuth:v0.3:dnaMatches",
  dnaHypothesis: "kinsleuth:v0.3:dnaHypothesis",
  cases: "kinsleuth:v0.3:cases",
  importPreviews: "kinsleuth:v0.3:importPreviews"
} as const;

export type StoredDnaMatch = DnaMatch & { helpfulnessScore: number };

export type StoredImportPreview = {
  id: string;
  sourceName: string;
  checksum: string;
  importedAt: string;
  recordCount: number;
  summary: ImportSummary;
};

export type WorkspaceSnapshot = {
  product: "KinSleuth";
  version: "0.3.0";
  exportedAt: string;
  dnaMatches: StoredDnaMatch[];
  dnaHypothesis?: DnaConnectionHypothesis;
  cases: ResearchCase[];
  importPreviews: StoredImportPreview[];
};

export type WorkspaceSnapshotCounts = {
  dnaMatches: number;
  cases: number;
  importPreviews: number;
};

export function createWorkspaceSnapshot(input: {
  dnaMatches?: StoredDnaMatch[];
  dnaHypothesis?: DnaConnectionHypothesis;
  cases?: ResearchCase[];
  importPreviews?: StoredImportPreview[];
  now?: Date;
}): WorkspaceSnapshot {
  return {
    product: "KinSleuth",
    version: "0.3.0",
    exportedAt: (input.now ?? new Date()).toISOString(),
    dnaMatches: input.dnaMatches ?? [],
    dnaHypothesis: input.dnaHypothesis,
    cases: input.cases ?? [],
    importPreviews: input.importPreviews ?? []
  };
}

export function parseWorkspaceSnapshot(value: string): WorkspaceSnapshot {
  const parsed = JSON.parse(value) as Partial<WorkspaceSnapshot>;

  if (parsed.product !== "KinSleuth") {
    throw new Error("Snapshot is not a KinSleuth export");
  }

  if (!Array.isArray(parsed.dnaMatches) || !Array.isArray(parsed.cases) || !Array.isArray(parsed.importPreviews)) {
    throw new Error("Snapshot is missing required workspace arrays");
  }

  return {
    product: "KinSleuth",
    version: parsed.version === "0.3.0" ? "0.3.0" : "0.3.0",
    exportedAt: parsed.exportedAt ?? new Date(0).toISOString(),
    dnaMatches: parsed.dnaMatches,
    dnaHypothesis: parsed.dnaHypothesis,
    cases: parsed.cases,
    importPreviews: parsed.importPreviews
  };
}

export function snapshotCounts(snapshot: Pick<WorkspaceSnapshot, "dnaMatches" | "cases" | "importPreviews">): WorkspaceSnapshotCounts {
  return {
    dnaMatches: snapshot.dnaMatches.length,
    cases: snapshot.cases.length,
    importPreviews: snapshot.importPreviews.length
  };
}

export function mergeDnaMatches(current: StoredDnaMatch[], incoming: StoredDnaMatch[]): StoredDnaMatch[] {
  return mergeById(current, incoming);
}

export function mergeCases(current: ResearchCase[], incoming: ResearchCase[]): ResearchCase[] {
  return mergeById(current, incoming);
}

export function mergeImportPreviews(current: StoredImportPreview[], incoming: StoredImportPreview[]): StoredImportPreview[] {
  return mergeById(current, incoming);
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

