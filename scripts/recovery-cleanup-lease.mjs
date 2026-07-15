#!/usr/bin/env node
import { chmod, readFile, writeFile } from "node:fs/promises";

import {
  createRecoveryCleanupLease,
  validateRecoveryCleanupLease,
  validateRecoveryCleanupLeaseSource
} from "../lib/recovery-cleanup-lease.ts";

try {
  const [mode, filePath, ...unexpected] = process.argv.slice(2);
  if (!mode || !filePath || unexpected.length > 0 || !["create", "validate", "validate-source"].includes(mode)) {
    throw new Error(
      "Usage: recovery-cleanup-lease.mjs <create|validate|validate-source> <cleanup-lease.json>."
    );
  }

  if (mode === "create") {
    const lease = createRecoveryCleanupLease(expectations());
    await writeFile(filePath, `${JSON.stringify(lease, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(filePath, 0o600);
    console.log("Created the immutable recovery cleanup lease.");
  } else {
    const value = await json(filePath);
    if (mode === "validate-source") {
      validateRecoveryCleanupLeaseSource(value, sourceExpectations());
    } else {
      validateRecoveryCleanupLease(value, expectations());
    }
    console.log("Validated the immutable recovery cleanup lease.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Recovery cleanup lease validation failed.");
  process.exitCode = 1;
}

async function json(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error("The recovery cleanup lease file is missing or invalid JSON.");
  }
}

function sourceExpectations() {
  return {
    sourceRunId: required("SOURCE_RUN_ID"),
    sourceRunAttempt: required("SOURCE_RUN_ATTEMPT"),
    releaseCommit: required("SOURCE_HEAD_SHA")
  };
}

function expectations() {
  return {
    ...sourceExpectations(),
    archiveId: required("EXPECTED_ARCHIVE_ID"),
    sourceDatabaseIdentity: required("KINRESOLVE_DATABASE_IDENTITY"),
    sourceObjectStorageIdentity: required("KINRESOLVE_OBJECT_STORAGE_IDENTITY"),
    sourceObjectStorageProviderId: required("KINRESOLVE_OBJECT_STORAGE_PROVIDER_ID"),
    sourceSupabaseProjectRef: required("SUPABASE_PROJECT_REF"),
    targetDatabaseIdentity: required("RECOVERY_TARGET_DATABASE_IDENTITY"),
    targetObjectStorageIdentity: required("RECOVERY_TARGET_OBJECT_STORAGE_IDENTITY"),
    targetObjectStorageProviderId: required("RECOVERY_TARGET_OBJECT_STORAGE_PROVIDER_ID"),
    targetSupabaseProjectRef: required("RECOVERY_TARGET_SUPABASE_PROJECT_REF")
  };
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
