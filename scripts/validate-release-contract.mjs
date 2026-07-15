#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { loadReleaseContractFiles, validateReleaseContract } from "../lib/release-contract.ts";

const fullCommitPattern = /^[0-9a-f]{40}$/;
const stableTagPattern = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

function gitOutput(args, failureMessage) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(failureMessage);
  }
  return result.stdout.trim();
}

function releaseIsOnMain(releaseCommit) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", releaseCommit, "origin/main"], {
    stdio: "ignore"
  });
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    throw new Error("Unable to verify that the released revision is on origin/main.");
  }
  return result.status === 0;
}

function requiredBoolean(name) {
  const value = process.env[name]?.trim().toLowerCase();
  if (value !== "true" && value !== "false") {
    throw new Error(`${name} must be exactly true or false.`);
  }
  return value === "true";
}

function optionalBoolean(name, defaultValue = false) {
  return process.env[name] === undefined ? defaultValue : requiredBoolean(name);
}

try {
  const releaseTag = process.env.RELEASE_TAG;
  if (!releaseTag || !stableTagPattern.test(releaseTag)) {
    throw new Error("RELEASE_TAG must be a stable vX.Y.Z tag.");
  }
  const requestedReleaseCommit = process.env.RELEASE_COMMIT;
  if (!requestedReleaseCommit || !fullCommitPattern.test(requestedReleaseCommit)) {
    throw new Error("RELEASE_COMMIT must be a full 40-character lowercase SHA.");
  }
  const resolvedReleaseCommit = gitOutput(
    ["rev-parse", "--verify", "--end-of-options", `${requestedReleaseCommit}^{commit}`],
    "Unable to resolve RELEASE_COMMIT to a commit."
  );
  const checkedOutCommit = gitOutput(
    ["rev-parse", "--verify", "HEAD^{commit}"],
    "Unable to resolve the checked-out revision."
  );
  if (resolvedReleaseCommit !== requestedReleaseCommit) {
    throw new Error("RELEASE_COMMIT must identify the commit exactly.");
  }
  if (resolvedReleaseCommit !== checkedOutCommit) {
    throw new Error("RELEASE_COMMIT must equal the checked-out revision.");
  }
  if (!releaseIsOnMain(resolvedReleaseCommit)) {
    throw new Error("RELEASE_COMMIT must be an ancestor of origin/main.");
  }

  const files = await loadReleaseContractFiles({ repositoryRoot: process.cwd() });
  const result = validateReleaseContract({
    ...files,
    releaseTag,
    releaseCommit: resolvedReleaseCommit,
    checkedOutCommit,
    releaseIsOnMain: true,
    expectedProjectId: process.env.EXPECTED_VERCEL_PROJECT_ID,
    expectedOrgId: process.env.VERCEL_ORG_ID,
    expectedAppBaseUrl: process.env.EXPECTED_APP_BASE_URL,
    expectedDatasetMode: process.env.EXPECTED_DATASET_MODE,
    expectedScheduledWritesEnabled: requiredBoolean("EXPECTED_SCHEDULED_WRITES_ENABLED"),
    expectedApiV1Enabled: requiredBoolean("EXPECTED_API_V1_ENABLED"),
    expectedBetaApplicationsEnabled: optionalBoolean("EXPECTED_BETA_APPLICATIONS_ENABLED"),
    expectedArchiveId: process.env.EXPECTED_ARCHIVE_ID,
    forbiddenProjectId: process.env.FORBIDDEN_VERCEL_PROJECT_ID,
    forbiddenAppBaseUrl: process.env.FORBIDDEN_APP_BASE_URL
  });
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    const outputs = [
      ["app_base_url", result.appOrigin],
      ["dataset_mode", result.datasetMode],
      ["archive_id", result.archiveId],
      ["database_identity", result.databaseIdentity],
      ["object_storage_identity", result.objectStorageIdentity],
      ["scheduled_writes_enabled", String(result.scheduledWritesEnabled)],
      ["api_v1_enabled", String(result.apiV1Enabled)],
      ["beta_applications_enabled", String(result.betaApplicationsEnabled)],
      ["version", result.version]
    ];
    if (outputs.some(([, value]) => /[\r\n]/u.test(value))) {
      throw new Error("Release outputs must be single-line values.");
    }
    await appendFile(
      outputPath,
      `${outputs.map(([key, value]) => `${key}=${value}`).join("\n")}\n`,
      "utf8"
    );
  }
  console.log(`Candidate release contract verified for v${result.version}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Release contract validation failed.");
  process.exitCode = 1;
}
