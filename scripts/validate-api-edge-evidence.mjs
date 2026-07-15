#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import {
  ApiEdgeEvidenceValidationError,
  validateApiEdgeEvidence
} from "../lib/api-edge-evidence.ts";

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw new Error(`${name} is required and must not contain surrounding whitespace.`);
  return value;
}

try {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length !== 1) throw new Error("Usage: validate-api-edge-evidence.mjs EVIDENCE_FILE");
  let evidence;
  try {
    evidence = JSON.parse(await readFile(arguments_[0], "utf8"));
  } catch {
    throw new Error("The API edge evidence file is not valid JSON.");
  }
  validateApiEdgeEvidence(evidence, {
    releaseCommit: required("RELEASE_COMMIT"),
    repository: required("GITHUB_REPOSITORY"),
    runId: required("API_EDGE_RUN_ID"),
    runAttempt: required("API_EDGE_RUN_ATTEMPT")
  });
  console.log("Release-bound API edge evidence verified.");
} catch (error) {
  console.error(
    error instanceof ApiEdgeEvidenceValidationError || error instanceof Error
      ? error.message
      : "API edge evidence validation failed."
  );
  process.exitCode = 1;
}
