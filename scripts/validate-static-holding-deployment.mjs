#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";

import { validateStaticHoldingCandidateDeployment } from "../lib/static-holding-deployment.ts";
import { parseVercelDeploymentJson } from "../lib/vercel-release-contract.ts";

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value;
}

try {
  const [filePath, ...unexpectedArguments] = process.argv.slice(2);
  if (!filePath || unexpectedArguments.length > 0) {
    throw new Error("Usage: validate-static-holding-deployment.mjs <json-file>.");
  }

  let contents;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error("Unable to read the Vercel deployment response file.", { cause: error });
  }
  const result = validateStaticHoldingCandidateDeployment(parseVercelDeploymentJson(contents), {
    expectedProjectId: requiredEnvironment("VERCEL_PROJECT_ID"),
    expectedOrgId: requiredEnvironment("VERCEL_ORG_ID"),
    appBaseUrl: requiredEnvironment("APP_BASE_URL")
  });

  const outputs = [
    `deployment_id=${result.id}`,
    `deployment_url=${result.url}`,
    `deployment_status=${result.status}`,
    ""
  ].join("\n");
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, outputs, "utf8");
  }
  process.stdout.write(outputs);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown validation failure.";
  console.error(`Static holding deployment validation failed: ${message}`);
  process.exitCode = 1;
}
