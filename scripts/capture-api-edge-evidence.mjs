#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

import {
  ApiEdgeEvidenceValidationError,
  createApiEdgeEvidence
} from "../lib/api-edge-evidence.ts";

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() !== value) throw new Error(`${name} is required and must not contain surrounding whitespace.`);
  return value;
}

function requiredInteger(name) {
  const value = required(name);
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${name} must be a positive integer.`);
  return Number(value);
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

try {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length !== 4) {
    throw new Error(
      "Usage: capture-api-edge-evidence.mjs ACTIVE_CONFIG_FILE BYPASS_FILE PROBE_FILE OUTPUT_FILE"
    );
  }
  const [configPath, bypassPath, probePath, outputPath] = arguments_;
  const activeConfig = await readJson(configPath, "The active firewall configuration");
  const systemBypasses = await readJson(bypassPath, "The system bypass response");
  const probe = await readJson(probePath, "The edge probe result");
  const rateAction = required("API_EDGE_EXPECTED_ACTION");
  if (rateAction !== "rate_limit") {
    throw new Error("API_EDGE_EXPECTED_ACTION must be rate_limit.");
  }
  const evidence = createApiEdgeEvidence({
    activeConfig,
    systemBypasses,
    probe,
    expectedRule: {
      ruleId: required("API_EDGE_RULE_ID"),
      limit: requiredInteger("API_EDGE_EXPECTED_LIMIT"),
      windowSeconds: requiredInteger("API_EDGE_EXPECTED_WINDOW_SECONDS"),
      rateAction
    },
    repository: required("GITHUB_REPOSITORY"),
    releaseCommit: required("RELEASE_COMMIT"),
    runId: required("GITHUB_RUN_ID"),
    runAttempt: required("GITHUB_RUN_ATTEMPT"),
    providerProjectId: required("VERCEL_PROJECT_ID"),
    directOrigin: required("VERCEL_DIRECT_ORIGIN")
  });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  console.log("Release-bound API edge evidence captured.");
} catch (error) {
  console.error(
    error instanceof ApiEdgeEvidenceValidationError || error instanceof Error
      ? error.message
      : "API edge evidence capture failed."
  );
  process.exitCode = 1;
}
