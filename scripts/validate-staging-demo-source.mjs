#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";

import { validateStagingDemoSourceRun } from "../lib/staging-demo-source.ts";

try {
  const [runPath, jobsPath, evidencePath, ...unexpected] = process.argv.slice(2);
  if (!runPath || !jobsPath || !evidencePath || unexpected.length > 0) {
    throw new Error(
      "Usage: validate-staging-demo-source.mjs <source-run.json> <source-jobs.json> <candidate-evidence.json>."
    );
  }
  const [runDocument, jobsDocument, evidenceDocument] = await Promise.all([
    readJson(runPath, "source release run"),
    readJson(jobsPath, "source release jobs"),
    readJson(evidencePath, "staging candidate evidence")
  ]);
  const result = validateStagingDemoSourceRun(runDocument, jobsDocument, evidenceDocument, {
    expectedRepository: required("GITHUB_REPOSITORY"),
    expectedRunId: required("SOURCE_RELEASE_RUN_ID"),
    expectedRunAttempt: required("SOURCE_RELEASE_RUN_ATTEMPT"),
    expectedHeadSha: required("SESSION_COMMIT")
  });
  const output = [
    `source_release_run_id=${result.runId}`,
    `source_release_run_attempt=${result.runAttempt}`,
    `source_release_sha=${result.headSha}`,
    `source_release_created_at=${result.createdAt}`,
    `release_version=${result.releaseVersion}`,
    `candidate_deployment_id=${result.candidateDeploymentId}`,
    ""
  ].join("\n");
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, output, "utf8");
  process.stdout.write(output);
} catch (error) {
  console.error(error instanceof Error
    ? `Staging demo source validation failed: ${error.message}`
    : "Staging demo source validation failed.");
  process.exitCode = 1;
}

async function readJson(filePath, label) {
  let contents;
  try {
    contents = await readFile(filePath, "utf8");
  } catch {
    throw new Error(`Unable to read the ${label} response.`);
  }
  try {
    return JSON.parse(contents);
  } catch {
    throw new Error(`The ${label} response is malformed.`);
  }
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
