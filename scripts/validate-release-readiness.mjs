#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";

import { validateReleaseReadinessEvidence } from "../lib/release-readiness.ts";
import { loadReleasePolicy } from "../lib/release-policy.ts";

try {
  const [filePath, ...unexpected] = process.argv.slice(2);
  if (!filePath || unexpected.length > 0) {
    throw new Error("Usage: validate-release-readiness.mjs <recovery-evidence.json>.");
  }
  let evidence;
  try {
    evidence = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error("Recovery evidence file is missing or invalid JSON.");
  }
  const policy = await loadReleasePolicy({ repositoryRoot: process.cwd() });
  const result = validateReleaseReadinessEvidence(evidence, {
    repository: required("GITHUB_REPOSITORY"),
    releaseCommit: required("RELEASE_COMMIT"),
    releaseVersion: required("RELEASE_VERSION"),
    databaseIdentity: required("KINRESOLVE_DATABASE_IDENTITY"),
    objectStorageIdentity: required("KINRESOLVE_OBJECT_STORAGE_IDENTITY"),
    targetDatabaseIdentity: required("RECOVERY_TARGET_DATABASE_IDENTITY"),
    targetObjectStorageIdentity: required("RECOVERY_TARGET_OBJECT_STORAGE_IDENTITY"),
    objectStorageProviderId: required("KINRESOLVE_OBJECT_STORAGE_PROVIDER_ID"),
    targetObjectStorageProviderId: required("RECOVERY_TARGET_OBJECT_STORAGE_PROVIDER_ID"),
    databaseProviderId: required("SUPABASE_PROJECT_REF"),
    targetDatabaseProviderId: required("RECOVERY_TARGET_SUPABASE_PROJECT_REF"),
    archiveId: required("EXPECTED_ARCHIVE_ID"),
    migrationVersions: policy.migrations.map((migration) => migration.file.replace(/\.sql$/, "")),
    migrationChecksums: Object.fromEntries(
      policy.migrations.map((migration) => [migration.file, migration.sha256])
    )
  });
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, [
      `fence_id=${result.fenceId}`,
      `fence_activated_at=${result.fenceActivatedAt}`,
      `evidence_expires_at=${result.evidenceExpiresAt}`,
      `migration_ledger_sha256=${result.migrationLedgerSha256}`,
      `source_migration_count=${result.sourceMigrationCount}`,
      `source_migration_ledger_sha256=${result.sourceMigrationLedgerSha256}`,
      `source_migration_policy_sha256=${result.sourceMigrationPolicySha256}`,
      ""
    ].join("\n"), "utf8");
  }
  console.log(`Attested recovery evidence verified; fence ${result.fenceId} remains active.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Release readiness validation failed.");
  process.exitCode = 1;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
