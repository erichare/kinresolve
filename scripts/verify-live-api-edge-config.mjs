#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import {
  ApiEdgeEvidenceValidationError,
  verifyLiveApiEdgeConfiguration
} from "../lib/api-edge-evidence.ts";

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

try {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length !== 3) {
    throw new Error(
      "Usage: verify-live-api-edge-config.mjs EVIDENCE_FILE ACTIVE_CONFIG_FILE BYPASS_FILE"
    );
  }
  const [evidencePath, configPath, bypassPath] = arguments_;
  verifyLiveApiEdgeConfiguration({
    evidence: await readJson(evidencePath, "The API edge evidence file"),
    activeConfig: await readJson(configPath, "The live Vercel firewall configuration"),
    systemBypasses: await readJson(bypassPath, "The live Vercel system bypass response")
  });
  console.log("Live Vercel API edge configuration matches the attested evidence.");
} catch (error) {
  console.error(
    error instanceof ApiEdgeEvidenceValidationError || error instanceof Error
      ? error.message
      : "Live API edge configuration verification failed."
  );
  process.exitCode = 1;
}
