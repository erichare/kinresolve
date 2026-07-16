#!/usr/bin/env node
import { writeFile } from "node:fs/promises";

import { createStagingDemoCandidateEvidence } from "../lib/staging-demo-source.ts";

try {
  const [outputPath, ...unexpected] = process.argv.slice(2);
  if (!outputPath || unexpected.length > 0) {
    throw new Error("Usage: create-staging-demo-candidate-evidence.mjs <output-path>.");
  }
  const evidence = createStagingDemoCandidateEvidence({
    repository: required("GITHUB_REPOSITORY"),
    runId: required("RELEASE_RUN_ID"),
    runAttempt: required("RELEASE_RUN_ATTEMPT"),
    headSha: required("RELEASE_COMMIT"),
    releaseVersion: required("RELEASE_VERSION"),
    candidateDeploymentId: required("CANDIDATE_DEPLOYMENT_ID")
  });
  await writeFile(outputPath, `${JSON.stringify(evidence)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  console.log("Created staging demo candidate evidence.");
} catch {
  console.error("Staging demo candidate evidence creation failed.");
  process.exitCode = 1;
}

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
