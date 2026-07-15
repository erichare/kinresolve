import { databaseIdentityPattern, supabaseProjectRefPattern } from "./database-attestation.ts";

const runNumberPattern = /^[1-9][0-9]{0,19}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const archiveIdPattern = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const providerStoreIdPattern = /^[a-z0-9][a-z0-9-]{7,63}$/;

const leaseKeys = [
  "schemaVersion",
  "sourceRunId",
  "sourceRunAttempt",
  "releaseCommit",
  "archiveId",
  "sourceDatabaseIdentity",
  "sourceObjectStorageIdentity",
  "sourceObjectStorageProviderId",
  "sourceSupabaseProjectRef",
  "targetDatabaseIdentity",
  "targetObjectStorageIdentity",
  "targetObjectStorageProviderId",
  "targetSupabaseProjectRef"
] as const;

export type RecoveryCleanupLease = {
  schemaVersion: 1;
  sourceRunId: string;
  sourceRunAttempt: string;
  releaseCommit: string;
  archiveId: string;
  sourceDatabaseIdentity: string;
  sourceObjectStorageIdentity: string;
  sourceObjectStorageProviderId: string;
  sourceSupabaseProjectRef: string;
  targetDatabaseIdentity: string;
  targetObjectStorageIdentity: string;
  targetObjectStorageProviderId: string;
  targetSupabaseProjectRef: string;
};

export type RecoveryCleanupLeaseSourceExpectations = Pick<
  RecoveryCleanupLease,
  "sourceRunId" | "sourceRunAttempt" | "releaseCommit"
>;

export type RecoveryCleanupLeaseExpectations = Omit<RecoveryCleanupLease, "schemaVersion">;

export function createRecoveryCleanupLease(
  input: RecoveryCleanupLeaseExpectations
): RecoveryCleanupLease {
  return validateRecoveryCleanupLease({ schemaVersion: 1, ...input }, input);
}

export function validateRecoveryCleanupLease(
  value: unknown,
  expected?: RecoveryCleanupLeaseExpectations
): RecoveryCleanupLease {
  const lease = object(value);
  exactKeys(lease);
  if (lease.schemaVersion !== 1) {
    throw new Error("The recovery cleanup lease schema is invalid.");
  }

  const validated: RecoveryCleanupLease = {
    schemaVersion: 1,
    sourceRunId: runNumber(lease.sourceRunId, "source run ID"),
    sourceRunAttempt: runNumber(lease.sourceRunAttempt, "source run attempt"),
    releaseCommit: pattern(lease.releaseCommit, commitPattern, "release commit"),
    archiveId: pattern(lease.archiveId, archiveIdPattern, "archive ID"),
    sourceDatabaseIdentity: pattern(
      lease.sourceDatabaseIdentity,
      databaseIdentityPattern,
      "source database identity"
    ),
    sourceObjectStorageIdentity: pattern(
      lease.sourceObjectStorageIdentity,
      databaseIdentityPattern,
      "source object-storage identity"
    ),
    sourceObjectStorageProviderId: pattern(
      lease.sourceObjectStorageProviderId,
      providerStoreIdPattern,
      "source object-storage provider ID"
    ),
    sourceSupabaseProjectRef: pattern(
      lease.sourceSupabaseProjectRef,
      supabaseProjectRefPattern,
      "source Supabase project ref"
    ),
    targetDatabaseIdentity: pattern(
      lease.targetDatabaseIdentity,
      databaseIdentityPattern,
      "target database identity"
    ),
    targetObjectStorageIdentity: pattern(
      lease.targetObjectStorageIdentity,
      databaseIdentityPattern,
      "target object-storage identity"
    ),
    targetObjectStorageProviderId: pattern(
      lease.targetObjectStorageProviderId,
      providerStoreIdPattern,
      "target object-storage provider ID"
    ),
    targetSupabaseProjectRef: pattern(
      lease.targetSupabaseProjectRef,
      supabaseProjectRefPattern,
      "target Supabase project ref"
    )
  };

  if (
    validated.sourceDatabaseIdentity === validated.targetDatabaseIdentity
    || validated.sourceObjectStorageIdentity === validated.targetObjectStorageIdentity
    || validated.sourceObjectStorageProviderId === validated.targetObjectStorageProviderId
    || validated.sourceSupabaseProjectRef === validated.targetSupabaseProjectRef
  ) {
    throw new Error("The recovery cleanup lease source and target cells must be distinct.");
  }

  if (expected) {
    for (const key of leaseKeys.slice(1) as Array<keyof RecoveryCleanupLeaseExpectations>) {
      if (validated[key] !== expected[key]) {
        throw new Error("The recovery cleanup lease does not match the protected recovery target.");
      }
    }
  }
  return validated;
}

export function validateRecoveryCleanupLeaseSource(
  value: unknown,
  expected: RecoveryCleanupLeaseSourceExpectations
): RecoveryCleanupLease {
  const lease = validateRecoveryCleanupLease(value);
  if (
    lease.sourceRunId !== runNumber(expected.sourceRunId, "expected source run ID")
    || lease.sourceRunAttempt !== runNumber(expected.sourceRunAttempt, "expected source run attempt")
    || lease.releaseCommit !== pattern(expected.releaseCommit, commitPattern, "expected release commit")
  ) {
    throw new Error("The recovery cleanup lease is not bound to the failed source run.");
  }
  return lease;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The recovery cleanup lease must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>): void {
  const actual = Object.keys(value).sort();
  const expected = [...leaseKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("The recovery cleanup lease fields are invalid.");
  }
}

function runNumber(value: unknown, label: string): string {
  return pattern(value, runNumberPattern, label);
}

function pattern(value: unknown, expected: RegExp, label: string): string {
  if (typeof value !== "string" || !expected.test(value)) {
    throw new Error(`The recovery cleanup lease ${label} is invalid.`);
  }
  return value;
}
