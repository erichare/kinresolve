#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { probeVercelCandidateProtection } from "../lib/vercel-candidate-protection-probe.ts";

try {
  const [deploymentPath, ...unexpected] = process.argv.slice(2);
  if (!deploymentPath || unexpected.length > 0) {
    throw new Error("Usage: probe-vercel-candidate-protection.mjs <deployment.json>.");
  }
  const document = JSON.parse(await readFile(deploymentPath, "utf8"));
  const result = await probeVercelCandidateProtection(document, {
    expectedProjectId: required("VERCEL_PROJECT_ID"),
    expectedOrgId: required("VERCEL_ORG_ID")
  });
  console.log(`Verified Deployment Protection on ${result.protectedOriginCount} generated origins.`);
} catch {
  console.error("Generated candidate Deployment Protection proof failed.");
  process.exitCode = 1;
}

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
