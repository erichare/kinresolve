import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createRecoveryCleanupLease,
  validateRecoveryCleanupLease,
  validateRecoveryCleanupLeaseSource,
  type RecoveryCleanupLeaseExpectations
} from "@/lib/recovery-cleanup-lease";

const scratch: string[] = [];
const expected: RecoveryCleanupLeaseExpectations = {
  sourceRunId: "123456789",
  sourceRunAttempt: "2",
  releaseCommit: "a".repeat(40),
  archiveId: "kinresolve-pilot-01",
  sourceDatabaseIdentity: "b".repeat(64),
  sourceObjectStorageIdentity: "c".repeat(64),
  sourceObjectStorageProviderId: "source-store-01",
  sourceSupabaseProjectRef: "d".repeat(20),
  targetDatabaseIdentity: "e".repeat(64),
  targetObjectStorageIdentity: "f".repeat(64),
  targetObjectStorageProviderId: "target-store-01",
  targetSupabaseProjectRef: "1".repeat(20)
};

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("immutable recovery cleanup lease", () => {
  it("accepts an exact, non-secret source-run and target binding", () => {
    const lease = createRecoveryCleanupLease(expected);
    expect(lease).toEqual({ schemaVersion: 1, ...expected });
    expect(validateRecoveryCleanupLease(lease, expected)).toEqual(lease);
    expect(validateRecoveryCleanupLeaseSource(lease, {
      sourceRunId: expected.sourceRunId,
      sourceRunAttempt: expected.sourceRunAttempt,
      releaseCommit: expected.releaseCommit
    })).toEqual(lease);
  });

  it.each([
    ["unknown field", (value: any) => { value.secret = "must-not-be-accepted"; }],
    ["missing field", (value: any) => { delete value.targetSupabaseProjectRef; }],
    ["schema", (value: any) => { value.schemaVersion = 2; }],
    ["run ID", (value: any) => { value.sourceRunId = "0"; }],
    ["run attempt", (value: any) => { value.sourceRunAttempt = "01"; }],
    ["commit", (value: any) => { value.releaseCommit = "A".repeat(40); }],
    ["archive", (value: any) => { value.archiveId = "../archive"; }],
    ["identity", (value: any) => { value.targetDatabaseIdentity = "invalid"; }],
    ["provider ID", (value: any) => { value.targetObjectStorageProviderId = "too_short"; }],
    ["Supabase ref", (value: any) => { value.targetSupabaseProjectRef = "invalid"; }]
  ])("rejects a lease with an invalid %s", (_label, mutate) => {
    const lease: any = { schemaVersion: 1, ...expected };
    mutate(lease);
    expect(() => validateRecoveryCleanupLease(lease)).toThrow(/lease/i);
  });

  it.each([
    ["database", "targetDatabaseIdentity", "sourceDatabaseIdentity"],
    ["object identity", "targetObjectStorageIdentity", "sourceObjectStorageIdentity"],
    ["object provider", "targetObjectStorageProviderId", "sourceObjectStorageProviderId"],
    ["Supabase project", "targetSupabaseProjectRef", "sourceSupabaseProjectRef"]
  ])("rejects a lease whose source and target %s are equal", (_label, target, source) => {
    const lease: any = { schemaVersion: 1, ...expected };
    lease[target] = lease[source];
    expect(() => validateRecoveryCleanupLease(lease)).toThrow(/distinct/i);
  });

  it("rejects any mismatch with the source event or current protected target", () => {
    const lease = createRecoveryCleanupLease(expected);
    expect(() => validateRecoveryCleanupLeaseSource(lease, {
      sourceRunId: expected.sourceRunId,
      sourceRunAttempt: "3",
      releaseCommit: expected.releaseCommit
    })).toThrow(/source run/i);
    expect(() => validateRecoveryCleanupLease(lease, {
      ...expected,
      targetObjectStorageIdentity: "0".repeat(64)
    })).toThrow(/protected recovery target/i);
  });

  it("creates and validates a mode-0600 lease through the CLI without secret fields", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "kinresolve-cleanup-lease-"));
    scratch.push(directory);
    const leasePath = path.join(directory, "production-recovery-cleanup-lease.json");
    const env = cliEnvironment();

    const created = cli("create", leasePath, env);
    expect(created.status).toBe(0);
    const lease = JSON.parse(await readFile(leasePath, "utf8"));
    expect(lease).toEqual({ schemaVersion: 1, ...expected });
    expect(JSON.stringify(lease)).not.toMatch(/token|password|secret|url/i);
    expect((await stat(leasePath)).mode & 0o777).toBe(0o600);

    expect(cli("validate-source", leasePath, env).status).toBe(0);
    expect(cli("validate", leasePath, env).status).toBe(0);
  });

  it("fails closed on invalid JSON and mismatched protected configuration in the CLI", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "kinresolve-cleanup-lease-"));
    scratch.push(directory);
    const leasePath = path.join(directory, "lease.json");
    await writeFile(leasePath, "not-json", "utf8");
    expect(cli("validate-source", leasePath, cliEnvironment()).status).toBe(1);

    await writeFile(leasePath, JSON.stringify({ schemaVersion: 1, ...expected }), "utf8");
    expect(cli("validate", leasePath, {
      ...cliEnvironment(),
      RECOVERY_TARGET_SUPABASE_PROJECT_REF: "2".repeat(20)
    }).status).toBe(1);
  });
});

function cli(mode: string, filePath: string, env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [
    "--no-warnings",
    "--experimental-strip-types",
    "scripts/recovery-cleanup-lease.mjs",
    mode,
    filePath
  ], { cwd: process.cwd(), encoding: "utf8", env });
}

function cliEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SOURCE_RUN_ID: expected.sourceRunId,
    SOURCE_RUN_ATTEMPT: expected.sourceRunAttempt,
    SOURCE_HEAD_SHA: expected.releaseCommit,
    EXPECTED_ARCHIVE_ID: expected.archiveId,
    KINRESOLVE_DATABASE_IDENTITY: expected.sourceDatabaseIdentity,
    KINRESOLVE_OBJECT_STORAGE_IDENTITY: expected.sourceObjectStorageIdentity,
    KINRESOLVE_OBJECT_STORAGE_PROVIDER_ID: expected.sourceObjectStorageProviderId,
    SUPABASE_PROJECT_REF: expected.sourceSupabaseProjectRef,
    RECOVERY_TARGET_DATABASE_IDENTITY: expected.targetDatabaseIdentity,
    RECOVERY_TARGET_OBJECT_STORAGE_IDENTITY: expected.targetObjectStorageIdentity,
    RECOVERY_TARGET_OBJECT_STORAGE_PROVIDER_ID: expected.targetObjectStorageProviderId,
    RECOVERY_TARGET_SUPABASE_PROJECT_REF: expected.targetSupabaseProjectRef
  };
}
