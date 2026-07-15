import { createHash } from "node:crypto";

const digestPattern = /^[a-f0-9]{64}$/;
const shaPattern = /^[a-f0-9]{40}$/;
const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const archiveIdPattern = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const providerStoreIdPattern = /^[a-z0-9][a-z0-9-]{7,63}$/;
const databaseProviderIdPattern = /^[a-z0-9]{20}$/;
const fenceIdPattern = /^fence-[a-z0-9][a-z0-9-]{7,63}$/;
const requiredFenceMigrationVersion = "013_release_write_fence";
const requiredDrainSeconds = 1_860;
const requiredChecks = [
  "app-health-ok",
  "candidate-database-semantics-verified",
  "candidate-ledger-exact",
  "database-pre-migration-restore-exact",
  "object-manifests-exact",
  "remaining-candidate-migrations-applied",
  "runtime-database-credential-distinct",
  "runtime-database-bounded-privilege",
  "runtime-database-target-observed",
  "target-database-destroyed",
  "target-object-data-removed"
] as const;
const namespaceNames = ["archive-private", "legacy-gedcom"] as const;
const cronPaths = ["/api/cron/import-uploads", "/api/cron/integration-jobs"] as const;

export type ReleaseReadinessExpectations = {
  repository: string;
  releaseCommit: string;
  releaseVersion: string;
  databaseIdentity: string;
  objectStorageIdentity: string;
  targetDatabaseIdentity: string;
  targetObjectStorageIdentity: string;
  objectStorageProviderId: string;
  targetObjectStorageProviderId: string;
  databaseProviderId: string;
  targetDatabaseProviderId: string;
  archiveId: string;
  migrationVersions: readonly string[];
  migrationChecksums: Readonly<Record<string, string>>;
  now?: Date;
};

export type ValidatedReleaseReadiness = {
  fenceId: string;
  fenceActivatedAt: string;
  evidenceExpiresAt: string;
  migrationLedgerSha256: string;
  sourceMigrationCount: number;
  sourceMigrationLedgerSha256: string;
  sourceMigrationPolicySha256: string;
};

export function migrationLedgerSha256(versions: readonly string[]): string {
  if (
    versions.length === 0
    || versions.some((version) => !/^\d{3}_[a-z0-9][a-z0-9_-]*$/.test(version))
  ) {
    throw new Error("The recovery evidence migration ledger is invalid.");
  }
  return createHash("sha256").update(`${versions.join("\n")}\n`, "utf8").digest("hex");
}

export function migrationPolicyPrefixSha256(
  versions: readonly string[],
  checksums: Readonly<Record<string, string>>
): string {
  if (
    versions.length === 0
    || versions.some((version) => !/^\d{3}_[a-z0-9][a-z0-9_-]*$/.test(version))
  ) {
    throw new Error("The recovery evidence migration policy prefix is invalid.");
  }
  const hash = createHash("sha256");
  hash.update("kinresolve-migration-policy-prefix-v1\0", "utf8");
  for (const version of versions) {
    const checksum = checksums[`${version}.sql`];
    if (!digest(checksum)) {
      throw new Error("The recovery evidence migration policy prefix checksum is invalid.");
    }
    hash.update(version, "utf8");
    hash.update("\0", "utf8");
    hash.update(checksum, "utf8");
    hash.update("\n", "utf8");
  }
  return hash.digest("hex");
}

export function validateReleaseReadinessEvidence(
  value: unknown,
  expected: ReleaseReadinessExpectations
): ValidatedReleaseReadiness {
  validateExpectations(expected);
  const evidence = object(value, "Recovery evidence");
  exactKeys(evidence, [
    "schemaVersion", "kind", "repository", "release", "issuedAt", "expiresAt",
    "sourceCell", "fence", "backup", "restore", "cleanup", "result"
  ], "Recovery evidence");
  if (evidence.schemaVersion !== 2 || evidence.kind !== "kinresolve.release-recovery") {
    throw new Error("Recovery evidence schema or kind is invalid.");
  }
  if (evidence.repository !== expected.repository || evidence.result !== "pass") {
    throw new Error("Recovery evidence repository or result does not match the release.");
  }

  const release = object(evidence.release, "Recovery evidence release");
  exactKeys(release, ["commitSha", "version"], "Recovery evidence release");
  if (release.commitSha !== expected.releaseCommit || release.version !== expected.releaseVersion) {
    throw new Error("Recovery evidence is not bound to the requested release.");
  }

  const now = expected.now ?? new Date();
  const issuedAt = timestamp(evidence.issuedAt, "Recovery evidence issuedAt");
  const expiresAt = timestamp(evidence.expiresAt, "Recovery evidence expiresAt");
  if (issuedAt.getTime() > now.getTime() + 5 * 60_000) {
    throw new Error("Recovery evidence is issued too far in the future.");
  }
  if (expiresAt.getTime() <= now.getTime() || expiresAt.getTime() - issuedAt.getTime() > 24 * 60 * 60_000) {
    throw new Error("Recovery evidence is expired or exceeds the 24-hour validity window.");
  }

  const sourceCell = object(evidence.sourceCell, "Recovery evidence sourceCell");
  exactKeys(
    sourceCell,
    [
      "environment", "databaseIdentity", "databaseProviderId", "archiveId", "objectStoreIdentity", "providerStoreId",
      "migrationPolicyPrefix"
    ],
    "Recovery evidence sourceCell"
  );
  if (
    sourceCell.environment !== "production"
    || sourceCell.databaseIdentity !== expected.databaseIdentity
    || !databaseProviderIdPattern.test(sourceCell.databaseProviderId as string)
    || sourceCell.databaseProviderId !== expected.databaseProviderId
    || sourceCell.archiveId !== expected.archiveId
    || sourceCell.objectStoreIdentity !== expected.objectStorageIdentity
    || sourceCell.providerStoreId !== expected.objectStorageProviderId
  ) {
    throw new Error("Recovery evidence source cell does not match production.");
  }
  const sourcePrefix = validateMigrationPolicyPrefix(
    sourceCell.migrationPolicyPrefix,
    expected.migrationVersions,
    expected.migrationChecksums
  );

  const fence = object(evidence.fence, "Recovery evidence fence");
  exactKeys(fence, [
    "id", "releaseCommitSha", "activatedAt", "drainedAt", "minimumDrainSeconds",
    "cronEndpoints", "activeJobLeases", "unexpiredUploadIntents", "stragglerTransactions",
    "stragglerVisibilityVerified", "stateDigestBefore", "stateDigestAfter"
  ], "Recovery evidence fence");
  const fenceId = string(fence.id, "Recovery evidence fence id");
  if (!fenceIdPattern.test(fenceId) || fence.releaseCommitSha !== expected.releaseCommit) {
    throw new Error("Recovery evidence fence is not bound to this release.");
  }
  const activatedAt = timestamp(fence.activatedAt, "Recovery evidence fence activatedAt");
  const drainedAt = timestamp(fence.drainedAt, "Recovery evidence fence drainedAt");
  const drainedSeconds = (drainedAt.getTime() - activatedAt.getTime()) / 1_000;
  if (fence.minimumDrainSeconds !== requiredDrainSeconds || drainedSeconds < requiredDrainSeconds) {
    throw new Error("Recovery evidence does not prove the required 31-minute write drain.");
  }
  if (
    fence.activeJobLeases !== 0
    || fence.unexpiredUploadIntents !== 0
    || fence.stragglerTransactions !== 0
    || fence.stragglerVisibilityVerified !== true
  ) {
    throw new Error("Recovery evidence reports active production work.");
  }
  if (
    !digest(fence.stateDigestBefore)
    || fence.stateDigestAfter !== fence.stateDigestBefore
  ) {
    throw new Error("Recovery evidence write-fence state changed during the drain.");
  }
  validateCronEndpoints(fence.cronEndpoints, fenceId);

  const backup = object(evidence.backup, "Recovery evidence backup");
  exactKeys(backup, [
    "completedAt", "providerRecoveryPointStatus", "databaseManifestSha256",
    "databaseCiphertextSha256", "objectCiphertextSha256", "objectNamespaces"
  ], "Recovery evidence backup");
  const backupCompletedAt = timestamp(backup.completedAt, "Recovery evidence backup completedAt");
  if (
    backup.providerRecoveryPointStatus !== "available"
    || !digest(backup.databaseManifestSha256)
    || !digest(backup.databaseCiphertextSha256)
    || !digest(backup.objectCiphertextSha256)
    || backupCompletedAt < drainedAt
    || backupCompletedAt > issuedAt
  ) {
    throw new Error("Recovery evidence backup is incomplete or out of order.");
  }
  const sourceNamespaces = validateNamespaces(backup.objectNamespaces, "Recovery evidence backup");

  const restore = object(evidence.restore, "Recovery evidence restore");
  exactKeys(restore, [
    "startedAt", "preMigrationRestoredAt", "migrationStartedAt", "migrationCompletedAt",
    "completedAt", "durationSeconds", "migrationDurationSeconds", "targetDatabaseIdentity",
    "targetDatabaseProviderId",
    "targetObjectStoreIdentity", "preMigrationDatabaseManifestSha256",
    "preMigrationLedgerSha256", "postMigrationDatabaseManifestSha256",
    "postMigrationLedgerSha256", "appliedMigrationVersions", "targetProviderStoreId",
    "runtimeDatabase", "objectNamespaces", "checks"
  ], "Recovery evidence restore");
  const restoreStartedAt = timestamp(restore.startedAt, "Recovery evidence restore startedAt");
  const preMigrationRestoredAt = timestamp(
    restore.preMigrationRestoredAt,
    "Recovery evidence restore preMigrationRestoredAt"
  );
  const migrationStartedAt = timestamp(
    restore.migrationStartedAt,
    "Recovery evidence restore migrationStartedAt"
  );
  const migrationCompletedAt = timestamp(
    restore.migrationCompletedAt,
    "Recovery evidence restore migrationCompletedAt"
  );
  const restoreCompletedAt = timestamp(restore.completedAt, "Recovery evidence restore completedAt");
  const restoreDuration = nonnegativeInteger(restore.durationSeconds, "Recovery evidence restore durationSeconds");
  const migrationDuration = nonnegativeInteger(
    restore.migrationDurationSeconds,
    "Recovery evidence restore migrationDurationSeconds"
  );
  if (
    restoreStartedAt < backupCompletedAt
    || preMigrationRestoredAt < restoreStartedAt
    || migrationStartedAt < preMigrationRestoredAt
    || migrationCompletedAt < migrationStartedAt
    || restoreCompletedAt < migrationCompletedAt
    || restoreCompletedAt < restoreStartedAt
    || restoreCompletedAt > issuedAt
    || restoreDuration > 8 * 60 * 60
    || Math.abs((restoreCompletedAt.getTime() - restoreStartedAt.getTime()) / 1_000 - restoreDuration) > 1
    || Math.abs((migrationCompletedAt.getTime() - migrationStartedAt.getTime()) / 1_000 - migrationDuration) > 1
  ) {
    throw new Error("Recovery evidence restore timing is invalid or exceeds eight hours.");
  }
  if (
    !digest(restore.targetDatabaseIdentity)
    || !digest(restore.targetObjectStoreIdentity)
    || restore.targetDatabaseIdentity !== expected.targetDatabaseIdentity
    || !databaseProviderIdPattern.test(restore.targetDatabaseProviderId as string)
    || restore.targetDatabaseProviderId === sourceCell.databaseProviderId
    || restore.targetDatabaseProviderId !== expected.targetDatabaseProviderId
    || restore.targetObjectStoreIdentity !== expected.targetObjectStorageIdentity
    || restore.targetDatabaseIdentity === sourceCell.databaseIdentity
    || restore.targetObjectStoreIdentity === sourceCell.objectStoreIdentity
    || restore.targetProviderStoreId !== expected.targetObjectStorageProviderId
    || restore.targetProviderStoreId === sourceCell.providerStoreId
  ) {
    throw new Error("Recovery evidence restore target must be a distinct database and object store.");
  }
  validateRuntimeDatabase(
    restore.runtimeDatabase,
    restore.targetDatabaseIdentity as string,
    restore.targetDatabaseProviderId as string
  );
  if (
    restore.preMigrationDatabaseManifestSha256 !== backup.databaseManifestSha256
    || restore.preMigrationLedgerSha256 !== sourcePrefix.ledgerSha256
  ) {
    throw new Error("Recovery evidence pre-migration database restore does not match the source prefix backup.");
  }
  const expectedLedger = migrationLedgerSha256(expected.migrationVersions);
  if (
    !digest(restore.postMigrationDatabaseManifestSha256)
    || restore.postMigrationLedgerSha256 !== expectedLedger
  ) {
    throw new Error("Recovery evidence post-migration ledger does not match the candidate policy.");
  }
  const expectedAppliedMigrations = expected.migrationVersions.slice(sourcePrefix.migrationCount);
  if (
    !Array.isArray(restore.appliedMigrationVersions)
    || JSON.stringify(restore.appliedMigrationVersions) !== JSON.stringify(expectedAppliedMigrations)
  ) {
    throw new Error("Recovery evidence did not apply exactly the candidate migrations remaining after the source prefix.");
  }
  const restoredNamespaces = validateNamespaces(restore.objectNamespaces, "Recovery evidence restore");
  for (const name of namespaceNames) {
    if (JSON.stringify(restoredNamespaces.get(name)) !== JSON.stringify(sourceNamespaces.get(name))) {
      throw new Error(`Recovery evidence restored ${name} manifest does not match the backup.`);
    }
  }
  if (
    !Array.isArray(restore.checks)
    || JSON.stringify([...restore.checks].sort()) !== JSON.stringify([...requiredChecks].sort())
  ) {
    throw new Error("Recovery evidence restore checks are incomplete.");
  }

  const cleanup = object(evidence.cleanup, "Recovery evidence cleanup");
  exactKeys(cleanup, [
    "targetObjectDataRemoved", "targetObjectDataRemovedAt", "targetObjectCountRemoved",
    "targetDatabaseDestroyed", "targetDatabaseDestroyedAt", "sourceDatabaseRetained"
  ], "Recovery evidence cleanup");
  const targetObjectDataRemovedAt = timestamp(
    cleanup.targetObjectDataRemovedAt,
    "Recovery evidence cleanup targetObjectDataRemovedAt"
  );
  const targetDatabaseDestroyedAt = timestamp(
    cleanup.targetDatabaseDestroyedAt,
    "Recovery evidence cleanup targetDatabaseDestroyedAt"
  );
  const expectedRestoredObjectCount = [...restoredNamespaces.values()]
    .reduce((total, namespace) => total + namespace[0], 0);
  if (
    cleanup.targetObjectDataRemoved !== true
    || cleanup.targetDatabaseDestroyed !== true
    || cleanup.sourceDatabaseRetained !== true
    || cleanup.targetObjectCountRemoved !== expectedRestoredObjectCount
    || targetObjectDataRemovedAt < restoreCompletedAt
    || targetDatabaseDestroyedAt <= targetObjectDataRemovedAt
    || targetDatabaseDestroyedAt > issuedAt
  ) {
    throw new Error("Recovery evidence does not prove complete, ordered target cleanup before issuance.");
  }

  return {
    fenceId,
    fenceActivatedAt: activatedAt.toISOString(),
    evidenceExpiresAt: expiresAt.toISOString(),
    migrationLedgerSha256: expectedLedger,
    sourceMigrationCount: sourcePrefix.migrationCount,
    sourceMigrationLedgerSha256: sourcePrefix.ledgerSha256,
    sourceMigrationPolicySha256: sourcePrefix.policySha256
  };
}

function validateExpectations(expected: ReleaseReadinessExpectations): void {
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(expected.repository)
    || !shaPattern.test(expected.releaseCommit)
    || !versionPattern.test(expected.releaseVersion)
    || !digest(expected.databaseIdentity)
    || !digest(expected.objectStorageIdentity)
    || !digest(expected.targetDatabaseIdentity)
    || !digest(expected.targetObjectStorageIdentity)
    || expected.databaseIdentity === expected.targetDatabaseIdentity
    || expected.objectStorageIdentity === expected.targetObjectStorageIdentity
    || !archiveIdPattern.test(expected.archiveId)
    || !providerStoreIdPattern.test(expected.objectStorageProviderId)
    || !providerStoreIdPattern.test(expected.targetObjectStorageProviderId)
    || expected.objectStorageProviderId === expected.targetObjectStorageProviderId
    || !databaseProviderIdPattern.test(expected.databaseProviderId)
    || !databaseProviderIdPattern.test(expected.targetDatabaseProviderId)
    || expected.databaseProviderId === expected.targetDatabaseProviderId
    || Object.keys(expected.migrationChecksums).some((file) => !/^\d{3}_[a-z0-9][a-z0-9_-]*\.sql$/.test(file))
    || Object.values(expected.migrationChecksums).some((checksum) => !digest(checksum))
    || Number.isNaN((expected.now ?? new Date()).getTime())
  ) {
    throw new Error("Release readiness expectations are invalid.");
  }
}

function validateRuntimeDatabase(value: unknown, databaseIdentity: string, databaseProviderId: string): void {
  const runtime = object(value, "Recovery evidence runtimeDatabase");
  exactKeys(runtime, [
    "schemaVersion", "databaseIdentity", "databaseProviderId", "runtimeRoleIdentitySha256",
    "credentialsDistinct", "sameDatabaseSessionVerified", "superuser", "bypassRls",
    "createDatabase", "createRole", "replication", "privilegedMembership", "ownerMembership",
    "ownsDatabase", "ownsPublicSchema", "ownedPublicRelations", "releaseFenceReadable",
    "releaseFenceMutable", "publicSchemaCreate", "representativeAppWriteRolledBack"
  ], "Recovery evidence runtimeDatabase");
  if (
    runtime.schemaVersion !== 1
    || runtime.databaseIdentity !== databaseIdentity
    || runtime.databaseProviderId !== databaseProviderId
    || !digest(runtime.runtimeRoleIdentitySha256)
    || runtime.credentialsDistinct !== true
    || runtime.sameDatabaseSessionVerified !== true
    || runtime.superuser !== false
    || typeof runtime.bypassRls !== "boolean"
    || runtime.createDatabase !== false
    || runtime.createRole !== false
    || runtime.replication !== false
    || runtime.privilegedMembership !== false
    || runtime.ownerMembership !== false
    || runtime.ownsDatabase !== false
    || runtime.ownsPublicSchema !== false
    || runtime.ownedPublicRelations !== 0
    || runtime.releaseFenceReadable !== true
    || runtime.releaseFenceMutable !== false
    || runtime.publicSchemaCreate !== false
    || runtime.representativeAppWriteRolledBack !== true
  ) {
    throw new Error("Recovery evidence runtime database role is privileged, unbound, or unproven.");
  }
}

function validateMigrationPolicyPrefix(
  value: unknown,
  expectedVersions: readonly string[],
  expectedChecksums: Readonly<Record<string, string>>
): { migrationCount: number; ledgerSha256: string; policySha256: string } {
  const prefix = object(value, "Recovery evidence migrationPolicyPrefix");
  exactKeys(prefix, [
    "migrationCount", "versions", "ledgerSha256", "policySha256",
    "fenceMigrationVersion", "fenceMigrationSha256"
  ], "Recovery evidence migrationPolicyPrefix");
  const migrationCount = nonnegativeInteger(
    prefix.migrationCount,
    "Recovery evidence migrationPolicyPrefix migrationCount"
  );
  if (
    migrationCount > expectedVersions.length
    || !Array.isArray(prefix.versions)
    || prefix.versions.length !== migrationCount
    || prefix.versions.some((version, index) => version !== expectedVersions[index])
  ) {
    throw new Error("Recovery evidence source ledger is not an exact candidate policy prefix.");
  }
  const versions = prefix.versions as string[];
  const fenceMigrationIndex = expectedVersions.indexOf(requiredFenceMigrationVersion);
  if (fenceMigrationIndex < 0 || migrationCount <= fenceMigrationIndex) {
    throw new Error("Recovery evidence source prefix must include migration 013 release write fence.");
  }
  const fenceMigrationSha256 = expectedChecksums[`${requiredFenceMigrationVersion}.sql`];
  const ledgerSha256 = migrationLedgerSha256(versions);
  const policySha256 = migrationPolicyPrefixSha256(versions, expectedChecksums);
  if (
    prefix.ledgerSha256 !== ledgerSha256
    || prefix.policySha256 !== policySha256
    || prefix.fenceMigrationVersion !== requiredFenceMigrationVersion
    || prefix.fenceMigrationSha256 !== fenceMigrationSha256
  ) {
    throw new Error("Recovery evidence source migration policy prefix checksum does not match the candidate.");
  }
  return { migrationCount, ledgerSha256, policySha256 };
}

function validateCronEndpoints(value: unknown, fenceId: string): void {
  if (!Array.isArray(value) || value.length !== cronPaths.length) {
    throw new Error("Recovery evidence must prove both fenced cron endpoints.");
  }
  const paths = new Set<string>();
  for (const item of value) {
    const endpoint = object(item, "Recovery evidence cron endpoint");
    exactKeys(endpoint, ["path", "status", "fenceId"], "Recovery evidence cron endpoint");
    if (!cronPaths.includes(endpoint.path as (typeof cronPaths)[number]) || endpoint.status !== 423 || endpoint.fenceId !== fenceId) {
      throw new Error("Recovery evidence cron endpoint is not fenced.");
    }
    paths.add(endpoint.path as string);
  }
  if (paths.size !== cronPaths.length) throw new Error("Recovery evidence cron endpoints must be unique.");
}

function validateNamespaces(value: unknown, label: string): Map<string, [number, number, string]> {
  if (!Array.isArray(value) || value.length !== namespaceNames.length) {
    throw new Error(`${label} must include both object namespaces.`);
  }
  const result = new Map<string, [number, number, string]>();
  for (const item of value) {
    const namespace = object(item, `${label} object namespace`);
    exactKeys(namespace, ["name", "objectCount", "totalBytes", "manifestSha256"], `${label} object namespace`);
    if (!namespaceNames.includes(namespace.name as (typeof namespaceNames)[number]) || result.has(namespace.name as string)) {
      throw new Error(`${label} object namespaces must be exact and unique.`);
    }
    const objectCount = nonnegativeInteger(namespace.objectCount, `${label} objectCount`);
    const totalBytes = nonnegativeInteger(namespace.totalBytes, `${label} totalBytes`);
    if (!digest(namespace.manifestSha256)) throw new Error(`${label} object manifest is invalid.`);
    result.set(namespace.name as string, [objectCount, totalBytes, namespace.manifestSha256 as string]);
  }
  return result;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} fields do not match the strict evidence schema.`);
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

function digest(value: unknown): value is string {
  return typeof value === "string" && digestPattern.test(value);
}

function timestamp(value: unknown, label: string): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error(`${label} must be an exact UTC timestamp.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a real UTC timestamp.`);
  }
  return parsed;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a nonnegative safe integer.`);
  }
  return value as number;
}
