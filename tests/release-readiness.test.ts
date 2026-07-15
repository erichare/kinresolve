import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  migrationLedgerSha256,
  migrationPolicyPrefixSha256,
  validateReleaseReadinessEvidence,
  type ReleaseReadinessExpectations
} from "@/lib/release-readiness";

const scratch: string[] = [];
const now = new Date("2026-07-15T12:00:00.000Z");
const expected: ReleaseReadinessExpectations = {
  repository: "erichare/kinresolve",
  releaseCommit: "a".repeat(40),
  releaseVersion: "0.18.0",
  databaseIdentity: "b".repeat(64),
  objectStorageIdentity: "3".repeat(64),
  targetDatabaseIdentity: "7".repeat(64),
  targetObjectStorageIdentity: "8".repeat(64),
  objectStorageProviderId: "source-store-01",
  targetObjectStorageProviderId: "target-store-01",
  databaseProviderId: "a".repeat(20),
  targetDatabaseProviderId: "b".repeat(20),
  archiveId: "kinresolve-pilot-01",
  migrationVersions: ["001_initial", "013_release_write_fence", "014_future_expansion"],
  migrationChecksums: {
    "001_initial.sql": "a".repeat(64),
    "013_release_write_fence.sql": "b".repeat(64),
    "014_future_expansion.sql": "c".repeat(64)
  },
  now
};

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("attested production recovery evidence", () => {
  it("accepts exact, fresh, release-bound backup and restore evidence", () => {
    expect(validateReleaseReadinessEvidence(evidence(), expected)).toEqual({
      fenceId: "fence-private-beta-01",
      fenceActivatedAt: "2026-07-15T05:00:00.000Z",
      evidenceExpiresAt: "2026-07-16T10:00:00.000Z",
      migrationLedgerSha256: migrationLedgerSha256(expected.migrationVersions),
      sourceMigrationCount: 2,
      sourceMigrationLedgerSha256: migrationLedgerSha256(expected.migrationVersions.slice(0, 2)),
      sourceMigrationPolicySha256: migrationPolicyPrefixSha256(
        expected.migrationVersions.slice(0, 2),
        expected.migrationChecksums
      )
    });
  });

  it.each([
    ["schema version", (value: any) => { value.schemaVersion = 1; }],
    ["repository", (value: any) => { value.repository = "attacker/repo"; }],
    ["release SHA", (value: any) => { value.release.commitSha = "c".repeat(40); }],
    ["database cell", (value: any) => { value.sourceCell.databaseIdentity = "c".repeat(64); }],
    ["source provider store", (value: any) => { value.sourceCell.providerStoreId = "wrong-store-01"; }],
    ["source database provider", (value: any) => { value.sourceCell.databaseProviderId = "c".repeat(20); }],
    ["target provider store", (value: any) => { value.restore.targetProviderStoreId = "wrong-store-02"; }],
    ["target database provider", (value: any) => { value.restore.targetDatabaseProviderId = "d".repeat(20); }],
    ["target database cell", (value: any) => { value.restore.targetDatabaseIdentity = "c".repeat(64); }],
    ["target object cell", (value: any) => { value.restore.targetObjectStoreIdentity = "d".repeat(64); }],
    ["failed result", (value: any) => { value.result = "fail"; }],
    ["unknown field", (value: any) => { value.unexpected = true; }]
  ])("rejects evidence with the wrong %s", (_label, mutate) => {
    const value = evidence();
    mutate(value);
    expect(() => validateReleaseReadinessEvidence(value, expected)).toThrow(/evidence|release|production/i);
  });

  it("rejects expired, future, overly broad, or out-of-order evidence", () => {
    for (const mutate of [
      (value: any) => { value.expiresAt = "2026-07-15T11:59:59.000Z"; },
      (value: any) => { value.issuedAt = "2026-07-15T12:06:00.000Z"; },
      (value: any) => { value.expiresAt = "2026-07-17T10:00:00.000Z"; },
      (value: any) => { value.restore.completedAt = "2026-07-15T10:30:00.000Z"; }
    ]) {
      const value = evidence();
      mutate(value);
      expect(() => validateReleaseReadinessEvidence(value, expected)).toThrow(/expired|future|validity|timing|order/i);
    }
  });

  it("requires a 31-minute fence, both 423 cron proofs, zero live work, and stable state", () => {
    for (const mutate of [
      (value: any) => { value.fence.minimumDrainSeconds = 300; },
      (value: any) => { value.fence.drainedAt = "2026-07-15T05:30:00.000Z"; },
      (value: any) => { value.fence.cronEndpoints[0].status = 200; },
      (value: any) => { value.fence.cronEndpoints.pop(); },
      (value: any) => { value.fence.activeJobLeases = 1; },
      (value: any) => { value.fence.unexpiredUploadIntents = 1; },
      (value: any) => { value.fence.stragglerTransactions = 1; },
      (value: any) => { value.fence.stragglerVisibilityVerified = false; },
      (value: any) => { value.fence.stateDigestAfter = "d".repeat(64); }
    ]) {
      const value = evidence();
      mutate(value);
      expect(() => validateReleaseReadinessEvidence(value, expected)).toThrow(/drain|cron|active|state|fence/i);
    }
  });

  it("requires exact encrypted backup, pre-migration restore equality, and final candidate semantics", () => {
    for (const mutate of [
      (value: any) => { value.backup.providerRecoveryPointStatus = "pending"; },
      (value: any) => { value.backup.objectCiphertextSha256 = "invalid"; },
      (value: any) => { value.restore.targetDatabaseIdentity = value.sourceCell.databaseIdentity; },
      (value: any) => { value.restore.targetObjectStoreIdentity = value.sourceCell.objectStoreIdentity; },
      (value: any) => { value.restore.targetProviderStoreId = value.sourceCell.providerStoreId; },
      (value: any) => { value.restore.targetDatabaseProviderId = value.sourceCell.databaseProviderId; },
      (value: any) => { value.restore.preMigrationDatabaseManifestSha256 = "e".repeat(64); },
      (value: any) => { value.restore.preMigrationLedgerSha256 = "e".repeat(64); },
      (value: any) => { value.restore.postMigrationLedgerSha256 = "e".repeat(64); },
      (value: any) => { value.restore.appliedMigrationVersions = []; },
      (value: any) => { value.restore.objectNamespaces[0].objectCount += 1; },
      (value: any) => { value.restore.checks.pop(); }
    ]) {
      const value = evidence();
      mutate(value);
      expect(() => validateReleaseReadinessEvidence(value, expected))
        .toThrow(/backup|restore|target|manifest|ledger|checks|migrations/i);
    }
  });

  it("requires a distinct bounded-privilege runtime role observed on the exact target", () => {
    for (const mutate of [
      (value: any) => { value.restore.runtimeDatabase.databaseIdentity = "f".repeat(64); },
      (value: any) => { value.restore.runtimeDatabase.databaseProviderId = "c".repeat(20); },
      (value: any) => { value.restore.runtimeDatabase.credentialsDistinct = false; },
      (value: any) => { value.restore.runtimeDatabase.sameDatabaseSessionVerified = false; },
      (value: any) => { value.restore.runtimeDatabase.superuser = true; },
      (value: any) => { value.restore.runtimeDatabase.ownerMembership = true; },
      (value: any) => { value.restore.runtimeDatabase.releaseFenceMutable = true; },
      (value: any) => { value.restore.runtimeDatabase.representativeAppWriteRolledBack = false; }
    ]) {
      const value = evidence();
      mutate(value);
      expect(() => validateReleaseReadinessEvidence(value, expected)).toThrow(/runtime|privileged|target/i);
    }
  });

  it("records and accepts the current single-cell runtime BYPASSRLS posture", () => {
    const value = evidence();
    value.restore.runtimeDatabase.bypassRls = true;
    expect(() => validateReleaseReadinessEvidence(value, expected)).not.toThrow();
  });

  it("requires object removal and target project destruction before evidence issuance", () => {
    for (const mutate of [
      (value: any) => { value.cleanup.targetObjectDataRemoved = false; },
      (value: any) => { value.cleanup.targetObjectCountRemoved += 1; },
      (value: any) => { value.cleanup.targetDatabaseDestroyed = false; },
      (value: any) => { value.cleanup.sourceDatabaseRetained = false; },
      (value: any) => { value.cleanup.targetObjectDataRemovedAt = value.restore.startedAt; },
      (value: any) => { value.cleanup.targetDatabaseDestroyedAt = value.cleanup.targetObjectDataRemovedAt; },
      (value: any) => { value.cleanup.targetDatabaseDestroyedAt = value.expiresAt; }
    ]) {
      const value = evidence();
      mutate(value);
      expect(() => validateReleaseReadinessEvidence(value, expected)).toThrow(/cleanup|removal|destroy/i);
    }
  });

  it("rejects a source before migration 013 or a non-prefix/checksum-substituted source", () => {
    for (const mutate of [
      (value: any) => {
        value.sourceCell.migrationPolicyPrefix.migrationCount = 1;
        value.sourceCell.migrationPolicyPrefix.versions = expected.migrationVersions.slice(0, 1);
      },
      (value: any) => { value.sourceCell.migrationPolicyPrefix.versions[0] = "999_attacker"; },
      (value: any) => { value.sourceCell.migrationPolicyPrefix.fenceMigrationSha256 = "d".repeat(64); },
      (value: any) => { value.sourceCell.migrationPolicyPrefix.policySha256 = "d".repeat(64); }
    ]) {
      const value = evidence();
      mutate(value);
      expect(() => validateReleaseReadinessEvidence(value, expected)).toThrow(/prefix|policy|migration 013|checksum/i);
    }
  });

  it("accepts the fresh current-schema first cutover as an explicit no-op migration", () => {
    const value = evidence({ sourceMigrationCount: expected.migrationVersions.length });
    expect(value.restore.appliedMigrationVersions).toEqual([]);
    expect(value.restore.postMigrationDatabaseManifestSha256)
      .toBe(value.restore.preMigrationDatabaseManifestSha256);
    expect(validateReleaseReadinessEvidence(value, expected).sourceMigrationCount)
      .toBe(expected.migrationVersions.length);
  });

  it("does not conflate pre-migration restore equality with the post-migration manifest", () => {
    const value = evidence();
    expect(value.restore.appliedMigrationVersions).toEqual(["014_future_expansion"]);
    value.restore.postMigrationDatabaseManifestSha256 =
      value.restore.preMigrationDatabaseManifestSha256;
    expect(() => validateReleaseReadinessEvidence(value, expected)).not.toThrow();
  });

  it("rejects omitted, equal, or mismatched physical object-store identities", () => {
    for (const mutate of [
      (value: any) => { delete value.sourceCell.providerStoreId; },
      (value: any) => { delete value.restore.targetProviderStoreId; },
      (value: any) => { value.restore.targetProviderStoreId = value.sourceCell.providerStoreId; },
      (value: any) => { value.sourceCell.providerStoreId = "different-source-store"; },
      (value: any) => { value.restore.targetProviderStoreId = "different-target-store"; }
    ]) {
      const value = evidence();
      mutate(value);
      expect(() => validateReleaseReadinessEvidence(value, expected)).toThrow(/field|production|target|provider/i);
    }
  });

  it("requires protected source and target database provider refs as release expectations", () => {
    for (const expectations of [
      { ...expected, databaseProviderId: undefined },
      { ...expected, targetDatabaseProviderId: undefined },
      { ...expected, targetDatabaseProviderId: expected.databaseProviderId }
    ]) {
      expect(() => validateReleaseReadinessEvidence(evidence(), expectations as any))
        .toThrow(/expectations/i);
    }
  });

  it("validates a file through a secret-free CLI against the checked-in policy", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "kinresolve-recovery-evidence-"));
    scratch.push(directory);
    const policy = JSON.parse(await readFile(path.join(process.cwd(), "db", "release-policy.json"), "utf8"));
    const migrationVersions = policy.migrations.map((migration: { file: string }) => migration.file.replace(/\.sql$/, ""));
    const migrationChecksums = Object.fromEntries(
      policy.migrations.map((migration: { file: string; sha256: string }) => [migration.file, migration.sha256])
    );
    const dynamicNow = new Date();
    const filePath = path.join(directory, "recovery-evidence.json");
    await writeFile(filePath, JSON.stringify(evidence({
      now: dynamicNow,
      migrationVersions,
      migrationChecksums,
      sourceMigrationCount: migrationVersions.length
    })), "utf8");
    const marker = "secret-marker-never-print";
    const outputPath = path.join(directory, "github-output.txt");

    const result = spawnSync(process.execPath, [
      "--no-warnings",
      "--experimental-strip-types",
      "scripts/validate-release-readiness.mjs",
      filePath
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        EXPECTED_ARCHIVE_ID: expected.archiveId,
        GITHUB_REPOSITORY: expected.repository,
        KINRESOLVE_DATABASE_IDENTITY: expected.databaseIdentity,
        KINRESOLVE_OBJECT_STORAGE_IDENTITY: expected.objectStorageIdentity,
        RECOVERY_TARGET_DATABASE_IDENTITY: expected.targetDatabaseIdentity,
        RECOVERY_TARGET_OBJECT_STORAGE_IDENTITY: expected.targetObjectStorageIdentity,
        KINRESOLVE_OBJECT_STORAGE_PROVIDER_ID: expected.objectStorageProviderId,
        RECOVERY_TARGET_OBJECT_STORAGE_PROVIDER_ID: expected.targetObjectStorageProviderId,
        SUPABASE_PROJECT_REF: expected.databaseProviderId,
        RECOVERY_TARGET_SUPABASE_PROJECT_REF: expected.targetDatabaseProviderId,
        GITHUB_OUTPUT: outputPath,
        RELEASE_COMMIT: expected.releaseCommit,
        RELEASE_VERSION: expected.releaseVersion,
        UNRELATED_SECRET: marker
      }
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/attested recovery evidence verified/i);
    expect(`${result.stdout}${result.stderr}`).not.toContain(marker);
    expect(await readFile(outputPath, "utf8")).toBe([
      "fence_id=fence-private-beta-01",
      `fence_activated_at=${JSON.parse(await readFile(filePath, "utf8")).fence.activatedAt}`,
      `evidence_expires_at=${JSON.parse(await readFile(filePath, "utf8")).expiresAt}`,
      `migration_ledger_sha256=${migrationLedgerSha256(migrationVersions)}`,
      `source_migration_count=${migrationVersions.length}`,
      `source_migration_ledger_sha256=${migrationLedgerSha256(migrationVersions)}`,
      `source_migration_policy_sha256=${migrationPolicyPrefixSha256(migrationVersions, migrationChecksums)}`,
      ""
    ].join("\n"));
  });
});

function evidence(options: {
  now?: Date;
  migrationVersions?: string[];
  migrationChecksums?: Record<string, string>;
  sourceMigrationCount?: number;
} = {}) {
  const dynamic = options.now;
  const issuedAt = dynamic ? new Date(dynamic.getTime() - 60 * 60_000) : new Date("2026-07-15T10:00:00.000Z");
  const expiresAt = dynamic ? new Date(dynamic.getTime() + 60 * 60_000) : new Date("2026-07-16T10:00:00.000Z");
  const activatedAt = new Date(issuedAt.getTime() - 5 * 60 * 60_000);
  const drainedAt = new Date(activatedAt.getTime() + 31 * 60_000);
  const backupCompletedAt = new Date(drainedAt.getTime() + 9 * 60_000);
  const restoreStartedAt = new Date(backupCompletedAt.getTime() + 5 * 60_000);
  const restoreCompletedAt = new Date(restoreStartedAt.getTime() + 60 * 60_000);
  const sourceNamespaces = [
    { name: "archive-private", objectCount: 3, totalBytes: 1024, manifestSha256: "1".repeat(64) },
    { name: "legacy-gedcom", objectCount: 1, totalBytes: 512, manifestSha256: "2".repeat(64) }
  ];
  const migrationVersions = options.migrationVersions ?? [...expected.migrationVersions];
  const migrationChecksums = options.migrationChecksums ?? expected.migrationChecksums;
  const sourceMigrationCount = options.sourceMigrationCount ?? 2;
  const sourceMigrationVersions = migrationVersions.slice(0, sourceMigrationCount);
  const sourceManifestSha256 = "5".repeat(64);
  const postMigrationManifestSha256 = sourceMigrationCount === migrationVersions.length
    ? sourceManifestSha256
    : "d".repeat(64);
  return {
    schemaVersion: 2,
    kind: "kinresolve.release-recovery",
    repository: expected.repository,
    release: { commitSha: expected.releaseCommit, version: expected.releaseVersion },
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    sourceCell: {
      environment: "production",
      databaseIdentity: expected.databaseIdentity,
      databaseProviderId: expected.databaseProviderId,
      archiveId: expected.archiveId,
      objectStoreIdentity: "3".repeat(64),
      providerStoreId: expected.objectStorageProviderId,
      migrationPolicyPrefix: {
        migrationCount: sourceMigrationCount,
        versions: sourceMigrationVersions,
        ledgerSha256: migrationLedgerSha256(sourceMigrationVersions),
        policySha256: migrationPolicyPrefixSha256(sourceMigrationVersions, migrationChecksums),
        fenceMigrationVersion: "013_release_write_fence",
        fenceMigrationSha256: migrationChecksums["013_release_write_fence.sql"]
      }
    },
    fence: {
      id: "fence-private-beta-01",
      releaseCommitSha: expected.releaseCommit,
      activatedAt: activatedAt.toISOString(),
      drainedAt: drainedAt.toISOString(),
      minimumDrainSeconds: 1860,
      cronEndpoints: [
        { path: "/api/cron/import-uploads", status: 423, fenceId: "fence-private-beta-01" },
        { path: "/api/cron/integration-jobs", status: 423, fenceId: "fence-private-beta-01" }
      ],
      activeJobLeases: 0,
      unexpiredUploadIntents: 0,
      stragglerTransactions: 0,
      stragglerVisibilityVerified: true,
      stateDigestBefore: "4".repeat(64),
      stateDigestAfter: "4".repeat(64)
    },
    backup: {
      completedAt: backupCompletedAt.toISOString(),
      providerRecoveryPointStatus: "available",
      databaseManifestSha256: sourceManifestSha256,
      databaseCiphertextSha256: "6".repeat(64),
      objectCiphertextSha256: "9".repeat(64),
      objectNamespaces: sourceNamespaces
    },
    restore: {
      startedAt: restoreStartedAt.toISOString(),
      preMigrationRestoredAt: new Date(restoreStartedAt.getTime() + 10 * 60_000).toISOString(),
      migrationStartedAt: new Date(restoreStartedAt.getTime() + 15 * 60_000).toISOString(),
      migrationCompletedAt: new Date(restoreStartedAt.getTime() + 25 * 60_000).toISOString(),
      completedAt: restoreCompletedAt.toISOString(),
      durationSeconds: 3600,
      migrationDurationSeconds: 600,
      targetDatabaseIdentity: expected.targetDatabaseIdentity,
      targetDatabaseProviderId: expected.targetDatabaseProviderId,
      targetObjectStoreIdentity: expected.targetObjectStorageIdentity,
      targetProviderStoreId: expected.targetObjectStorageProviderId,
      preMigrationDatabaseManifestSha256: sourceManifestSha256,
      preMigrationLedgerSha256: migrationLedgerSha256(sourceMigrationVersions),
      postMigrationDatabaseManifestSha256: postMigrationManifestSha256,
      postMigrationLedgerSha256: migrationLedgerSha256(migrationVersions),
      appliedMigrationVersions: migrationVersions.slice(sourceMigrationCount),
      runtimeDatabase: {
        schemaVersion: 1,
        databaseIdentity: expected.targetDatabaseIdentity,
        databaseProviderId: expected.targetDatabaseProviderId,
        runtimeRoleIdentitySha256: "e".repeat(64),
        credentialsDistinct: true,
        sameDatabaseSessionVerified: true,
        superuser: false,
        bypassRls: false,
        createDatabase: false,
        createRole: false,
        replication: false,
        privilegedMembership: false,
        ownerMembership: false,
        ownsDatabase: false,
        ownsPublicSchema: false,
        ownedPublicRelations: 0,
        releaseFenceReadable: true,
        releaseFenceMutable: false,
        publicSchemaCreate: false,
        representativeAppWriteRolledBack: true
      },
      objectNamespaces: sourceNamespaces.map((value) => ({ ...value })),
      checks: [
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
      ]
    },
    cleanup: {
      targetObjectDataRemoved: true,
      targetObjectDataRemovedAt: new Date(restoreCompletedAt.getTime() + 60_000).toISOString(),
      targetObjectCountRemoved: sourceNamespaces.reduce((total, namespace) => total + namespace.objectCount, 0),
      targetDatabaseDestroyed: true,
      targetDatabaseDestroyedAt: new Date(restoreCompletedAt.getTime() + 120_000).toISOString(),
      sourceDatabaseRetained: true
    },
    result: "pass"
  };
}
