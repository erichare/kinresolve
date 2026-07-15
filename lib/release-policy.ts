import { readFile } from "node:fs/promises";
import path from "node:path";

export const PINNED_BASELINE_TAG = "v0.17.4";
export const PINNED_BASELINE_COMMIT = "6f544ea8a5e92fbb68230db1cce4cb9231a40247";
export const PINNED_BASELINE_MIGRATION = "001_initial.sql";
export const PINNED_BASELINE_SHA256 = "9023c8a546dcab04a1fb01ae37cd81c2819025e1251a3b9c95df08dea3617c40";
export const FIRST_CUTOVER_ACKNOWLEDGEMENT =
  "I acknowledge this first hosted cutover is forward-only; v0.17.4 must never run against the migrated pilot database; recovery is maintenance, forward-fix, or restore to a new cell until a compatible rollback anchor is established.";
export const LEGACY_COMPATIBILITY_EXPECTATIONS = [
  {
    id: "auth-account-boundary",
    migrationFiles: ["003_auth_accounts.sql"],
    expectedObservation: "shared-session-valid-without-current-user-or-membership"
  },
  {
    id: "guided-state-preservation",
    migrationFiles: ["005_guided_research_loop.sql"],
    expectedObservation: "legacy-rewrite-resets-current-guided-fields"
  },
  {
    id: "integration-reference-preservation",
    migrationFiles: ["006_integration_sources.sql"],
    expectedObservation: "legacy-rewrite-rejected-by-current-reference"
  },
  {
    id: "pilot-seed-isolation",
    migrationFiles: ["012_archive_dataset_mode.sql"],
    expectedObservation: "legacy-read-seeds-demo-fixtures-into-pilot"
  }
] as const;

const acknowledgementVersion = "first-hosted-cutover-v1";
const migrationFilePattern = /^\d{3}_[a-z0-9][a-z0-9_-]*\.sql$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const migrationRisks = ["baseline", "low", "moderate", "high"] as const;
const migrationCompatibilities = ["baseline", "expansion-compatible", "legacy-incompatible"] as const;

export type MigrationRisk = (typeof migrationRisks)[number];
export type MigrationCompatibility = (typeof migrationCompatibilities)[number];

export type ReleaseMigrationPolicy = {
  file: string;
  sha256: string;
  risk: MigrationRisk;
  compatibility: MigrationCompatibility;
  notes: string;
};

export type LegacyCompatibilityExpectation = {
  id: (typeof LEGACY_COMPATIBILITY_EXPECTATIONS)[number]["id"];
  migrationFiles: string[];
  expectedObservation: (typeof LEGACY_COMPATIBILITY_EXPECTATIONS)[number]["expectedObservation"];
};

export type ReleasePolicy = {
  schemaVersion: 1;
  baseline: {
    tag: typeof PINNED_BASELINE_TAG;
    commit: typeof PINNED_BASELINE_COMMIT;
    migrationFile: typeof PINNED_BASELINE_MIGRATION;
    sha256: typeof PINNED_BASELINE_SHA256;
  };
  rollbackPolicy: "forward-only";
  firstCompatibleRollbackAnchor: null;
  legacyCompatibility: {
    tag: typeof PINNED_BASELINE_TAG;
    commit: typeof PINNED_BASELINE_COMMIT;
    expectedResult: "incompatible-forward-only";
    requiredEvidence: LegacyCompatibilityExpectation[];
  };
  firstCutover: {
    acknowledgementVersion: typeof acknowledgementVersion;
    requiredAcknowledgement: typeof FIRST_CUTOVER_ACKNOWLEDGEMENT;
  };
  migrations: ReleaseMigrationPolicy[];
};

export type ReleasePolicyAcknowledgement = {
  owner: string;
  acknowledgedAt: string;
  acknowledgementVersion: typeof acknowledgementVersion;
};

type ValidateReleasePolicyInput = {
  policy: unknown;
  checksums: unknown;
};

type ValidateAcknowledgementInput = {
  policy: ReleasePolicy;
  owner?: string;
  acknowledgedAt?: string;
  acknowledgement?: string;
};

type LoadReleasePolicyOptions = {
  repositoryRoot: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const expectedSet = new Set(expected);
  const unexpected = Object.keys(value).filter((key) => !expectedSet.has(key)).sort();
  if (unexpected.length > 0) {
    throw new Error(`${label} contains unexpected field ${unexpected[0]}.`);
  }
  const missing = expected.filter((key) => !(key in value));
  if (missing.length > 0) {
    throw new Error(`${label} is missing required field ${missing[0]}.`);
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function parseMigrationEntry(value: unknown, index: number): ReleaseMigrationPolicy {
  const label = `Release policy migration entry ${index + 1}`;
  const entry = requireRecord(value, label);
  requireExactKeys(entry, ["file", "sha256", "risk", "compatibility", "notes"], label);

  const file = requireString(entry.file, `${label} file`);
  if (!migrationFilePattern.test(file)) {
    throw new Error(`${label} contains an invalid migration filename.`);
  }
  const sha256 = requireString(entry.sha256, `${label} sha256`);
  if (!sha256Pattern.test(sha256)) {
    throw new Error(`${label} contains an invalid SHA-256 checksum.`);
  }

  const risk = requireString(entry.risk, `${label} risk`);
  if (!migrationRisks.includes(risk as MigrationRisk)) {
    throw new Error(`${label} risk must be baseline, low, moderate, or high.`);
  }
  const compatibility = requireString(entry.compatibility, `${label} compatibility`);
  if (!migrationCompatibilities.includes(compatibility as MigrationCompatibility)) {
    throw new Error(
      `${label} compatibility must be baseline, expansion-compatible, or legacy-incompatible.`
    );
  }

  const notes = requireString(entry.notes, `${label} notes`);
  if (notes !== notes.trim() || notes.length < 20 || notes.length > 240 || !/^[\x20-\x7e]+$/.test(notes)) {
    throw new Error(`${label} notes must be safe single-line ASCII text between 20 and 240 characters.`);
  }

  if (file === PINNED_BASELINE_MIGRATION) {
    if (risk !== "baseline" || compatibility !== "baseline") {
      throw new Error("The pinned baseline migration must use baseline risk and compatibility classifications.");
    }
  } else if (risk === "baseline" || compatibility === "baseline") {
    throw new Error(`Only ${PINNED_BASELINE_MIGRATION} may use a baseline classification.`);
  }

  return {
    file,
    sha256,
    risk: risk as MigrationRisk,
    compatibility: compatibility as MigrationCompatibility,
    notes
  };
}

function parseChecksumFiles(checksumsValue: unknown): {
  files: Record<string, string>;
  baselineAnchorChecksum: string;
} {
  const checksums = requireRecord(checksumsValue, "Migration checksum manifest");
  requireExactKeys(checksums, ["schemaVersion", "files", "releaseAnchors"], "Migration checksum manifest");
  if (checksums.schemaVersion !== 1) {
    throw new Error("Migration checksum manifest must use schemaVersion 1.");
  }

  const filesValue = requireRecord(checksums.files, "Migration checksum manifest files");
  const files: Record<string, string> = {};
  for (const [file, checksumValue] of Object.entries(filesValue)) {
    if (!migrationFilePattern.test(file)) {
      throw new Error(`Migration checksum manifest contains an invalid migration filename: ${file}.`);
    }
    const checksum = requireString(checksumValue, `Migration checksum for ${file}`);
    if (!sha256Pattern.test(checksum)) {
      throw new Error(`Migration checksum manifest contains an invalid SHA-256 checksum for ${file}.`);
    }
    files[file] = checksum;
  }

  const releaseAnchors = requireRecord(checksums.releaseAnchors, "Migration checksum releaseAnchors");
  const baselineAnchor = requireRecord(
    releaseAnchors[PINNED_BASELINE_TAG],
    `Migration checksum release anchor ${PINNED_BASELINE_TAG}`
  );
  const baselineAnchorChecksum = requireString(
    baselineAnchor[PINNED_BASELINE_MIGRATION],
    `Migration checksum release anchor ${PINNED_BASELINE_TAG}/${PINNED_BASELINE_MIGRATION}`
  );
  if (baselineAnchorChecksum !== PINNED_BASELINE_SHA256) {
    throw new Error(
      `Migration checksum release anchor ${PINNED_BASELINE_TAG}/${PINNED_BASELINE_MIGRATION} must remain pinned.`
    );
  }
  if (files[PINNED_BASELINE_MIGRATION] !== PINNED_BASELINE_SHA256) {
    throw new Error(`Migration checksum manifest ${PINNED_BASELINE_MIGRATION} must remain pinned.`);
  }

  return { files, baselineAnchorChecksum };
}

function parseLegacyCompatibility(
  value: unknown,
  migrations: ReleaseMigrationPolicy[]
): ReleasePolicy["legacyCompatibility"] {
  const compatibility = requireRecord(value, "Release policy legacyCompatibility");
  requireExactKeys(
    compatibility,
    ["tag", "commit", "expectedResult", "requiredEvidence"],
    "Release policy legacyCompatibility"
  );
  if (compatibility.tag !== PINNED_BASELINE_TAG) {
    throw new Error(`Release policy legacyCompatibility tag must remain ${PINNED_BASELINE_TAG}.`);
  }
  if (compatibility.commit !== PINNED_BASELINE_COMMIT) {
    throw new Error(`Release policy legacyCompatibility commit must remain ${PINNED_BASELINE_COMMIT}.`);
  }
  if (compatibility.expectedResult !== "incompatible-forward-only") {
    throw new Error("Release policy legacyCompatibility expectedResult must be incompatible-forward-only.");
  }
  if (!Array.isArray(compatibility.requiredEvidence)) {
    throw new Error("Release policy legacyCompatibility requiredEvidence must be an array.");
  }
  if (compatibility.requiredEvidence.length !== LEGACY_COMPATIBILITY_EXPECTATIONS.length) {
    throw new Error("Release policy legacyCompatibility requiredEvidence must contain every reviewed expectation exactly once.");
  }

  const migrationByFile = new Map(migrations.map((migration) => [migration.file, migration]));
  const requiredEvidence = compatibility.requiredEvidence.map((rawExpectation, index) => {
    const label = `Release policy legacyCompatibility evidence ${index + 1}`;
    const expectation = requireRecord(rawExpectation, label);
    requireExactKeys(expectation, ["id", "migrationFiles", "expectedObservation"], label);
    const reviewed = LEGACY_COMPATIBILITY_EXPECTATIONS[index];
    if (expectation.id !== reviewed.id) {
      throw new Error(`${label} id must be exactly ${reviewed.id}.`);
    }
    if (expectation.expectedObservation !== reviewed.expectedObservation) {
      throw new Error(`${label} expectedObservation must match the reviewed compatibility observation.`);
    }
    if (
      !Array.isArray(expectation.migrationFiles) ||
      expectation.migrationFiles.length !== reviewed.migrationFiles.length ||
      expectation.migrationFiles.some((file, fileIndex) => file !== reviewed.migrationFiles[fileIndex])
    ) {
      throw new Error(`${label} migrationFiles must match the reviewed compatibility mapping exactly.`);
    }
    for (const file of reviewed.migrationFiles) {
      if (migrationByFile.get(file)?.compatibility !== "legacy-incompatible") {
        throw new Error(`${label} must reference a migration classified as legacy-incompatible.`);
      }
    }
    return {
      id: reviewed.id,
      migrationFiles: [...reviewed.migrationFiles],
      expectedObservation: reviewed.expectedObservation
    };
  });

  return {
    tag: PINNED_BASELINE_TAG,
    commit: PINNED_BASELINE_COMMIT,
    expectedResult: "incompatible-forward-only",
    requiredEvidence
  };
}

export function validateReleasePolicy(input: ValidateReleasePolicyInput): ReleasePolicy {
  const policy = requireRecord(input.policy, "Release policy");
  requireExactKeys(
    policy,
    [
      "schemaVersion",
      "baseline",
      "rollbackPolicy",
      "firstCompatibleRollbackAnchor",
      "legacyCompatibility",
      "firstCutover",
      "migrations"
    ],
    "Release policy"
  );
  if (policy.schemaVersion !== 1) {
    throw new Error("Release policy must use schemaVersion 1.");
  }

  const baseline = requireRecord(policy.baseline, "Release policy baseline");
  requireExactKeys(baseline, ["tag", "commit", "migrationFile", "sha256"], "Release policy baseline");
  if (baseline.tag !== PINNED_BASELINE_TAG) {
    throw new Error(`Release policy baseline tag must remain ${PINNED_BASELINE_TAG}.`);
  }
  if (baseline.commit !== PINNED_BASELINE_COMMIT) {
    throw new Error(`Release policy baseline commit must remain ${PINNED_BASELINE_COMMIT}.`);
  }
  if (baseline.migrationFile !== PINNED_BASELINE_MIGRATION) {
    throw new Error(`Release policy baseline migration must remain ${PINNED_BASELINE_MIGRATION}.`);
  }
  if (baseline.sha256 !== PINNED_BASELINE_SHA256) {
    throw new Error("Release policy baseline checksum must remain pinned to the immutable v0.17.4 migration.");
  }
  if (policy.rollbackPolicy !== "forward-only") {
    throw new Error("Release policy rollbackPolicy must be exactly forward-only.");
  }
  if (policy.firstCompatibleRollbackAnchor !== null) {
    throw new Error("Release policy firstCompatibleRollbackAnchor must remain null until compatibility evidence exists.");
  }

  const firstCutover = requireRecord(policy.firstCutover, "Release policy firstCutover");
  requireExactKeys(
    firstCutover,
    ["acknowledgementVersion", "requiredAcknowledgement"],
    "Release policy firstCutover"
  );
  if (firstCutover.acknowledgementVersion !== acknowledgementVersion) {
    throw new Error(`Release policy acknowledgementVersion must be exactly ${acknowledgementVersion}.`);
  }
  if (firstCutover.requiredAcknowledgement !== FIRST_CUTOVER_ACKNOWLEDGEMENT) {
    throw new Error("Release policy requiredAcknowledgement must match the reviewed first-cutover statement exactly.");
  }

  if (!Array.isArray(policy.migrations) || policy.migrations.length === 0) {
    throw new Error("Release policy migrations must be a nonempty array.");
  }
  const migrations = policy.migrations.map(parseMigrationEntry);
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (seen.has(migration.file)) {
      throw new Error(`Release policy contains duplicate migration entry ${migration.file}.`);
    }
    seen.add(migration.file);
  }
  const sortedFiles = migrations.map((migration) => migration.file).sort();
  for (let index = 0; index < migrations.length; index += 1) {
    if (migrations[index].file !== sortedFiles[index]) {
      throw new Error("Release policy migration entries must be ordered by filename.");
    }
  }

  const { files: checksumFiles } = parseChecksumFiles(input.checksums);
  for (const migration of migrations) {
    const expectedChecksum = checksumFiles[migration.file];
    if (expectedChecksum === undefined) {
      throw new Error(`Release policy migration is not recorded in checksums.json: ${migration.file}.`);
    }
    if (migration.sha256 !== expectedChecksum) {
      throw new Error(`Release policy checksum mismatch for ${migration.file}.`);
    }
  }
  for (const file of Object.keys(checksumFiles).sort()) {
    if (!seen.has(file)) {
      throw new Error(`Release policy is missing policy entry for ${file}.`);
    }
  }

  const legacyCompatibility = parseLegacyCompatibility(policy.legacyCompatibility, migrations);

  return {
    schemaVersion: 1,
    baseline: {
      tag: PINNED_BASELINE_TAG,
      commit: PINNED_BASELINE_COMMIT,
      migrationFile: PINNED_BASELINE_MIGRATION,
      sha256: PINNED_BASELINE_SHA256
    },
    rollbackPolicy: "forward-only",
    firstCompatibleRollbackAnchor: null,
    legacyCompatibility,
    firstCutover: {
      acknowledgementVersion,
      requiredAcknowledgement: FIRST_CUTOVER_ACKNOWLEDGEMENT
    },
    migrations
  };
}

function isStrictRfc3339Timestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offset] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return false;

  if (offset !== "Z") {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}

export function validateFirstCutoverAcknowledgement(
  input: ValidateAcknowledgementInput
): ReleasePolicyAcknowledgement {
  const owner = input.owner;
  if (
    typeof owner !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner) ||
    owner.includes("--")
  ) {
    throw new Error("RELEASE_POLICY_OWNER must be a safe GitHub login with 1-39 letters, digits, or interior hyphens.");
  }

  const acknowledgedAt = input.acknowledgedAt;
  if (typeof acknowledgedAt !== "string" || !isStrictRfc3339Timestamp(acknowledgedAt)) {
    throw new Error("RELEASE_POLICY_ACKNOWLEDGED_AT must be a strict RFC3339 timestamp with an explicit timezone.");
  }

  if (
    input.policy.firstCutover.requiredAcknowledgement !== FIRST_CUTOVER_ACKNOWLEDGEMENT ||
    input.acknowledgement !== input.policy.firstCutover.requiredAcknowledgement
  ) {
    throw new Error("FIRST_CUTOVER_ACKNOWLEDGEMENT must exactly match the reviewed forward-only statement.");
  }

  return {
    owner,
    acknowledgedAt,
    acknowledgementVersion
  };
}

async function readJsonFile(filePath: string, label: string): Promise<unknown> {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`${label} is missing or unreadable.`, { cause: error });
  }
  try {
    return JSON.parse(contents) as unknown;
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`, { cause: error });
  }
}

export async function loadReleasePolicy(options: LoadReleasePolicyOptions): Promise<ReleasePolicy> {
  const policy = await readJsonFile(path.join(options.repositoryRoot, "db", "release-policy.json"), "Release policy");
  const checksums = await readJsonFile(
    path.join(options.repositoryRoot, "db", "migrations", "checksums.json"),
    "Migration checksum manifest"
  );
  return validateReleasePolicy({ policy, checksums });
}
