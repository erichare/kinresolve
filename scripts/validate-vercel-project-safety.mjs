#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { validateVercelProjectSafety } from "../lib/vercel-project-safety.ts";

try {
  const [filePath, ...unexpected] = process.argv.slice(2);
  if (!filePath || unexpected.length > 0) {
    throw new Error("Usage: validate-vercel-project-safety.mjs <project.json>.");
  }
  const expectedPausedValue = process.env.EXPECTED_VERCEL_PROJECT_PAUSED?.trim();
  const expectedPaused = expectedPausedValue === undefined || expectedPausedValue === ""
    ? undefined
    : boolean(expectedPausedValue);
  const result = validateVercelProjectSafety(
    JSON.parse(await readFile(filePath, "utf8")),
    {
      expectedProjectId: required("VERCEL_PROJECT_ID"),
      expectedOrgId: required("VERCEL_ORG_ID"),
      ...(expectedPaused === undefined ? {} : { expectedPaused })
    }
  );
  process.stdout.write(
    `auto_assignment_disabled=true\nproject_paused=${result.paused ? "true" : "false"}\n`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Vercel project safety validation failed.");
  process.exitCode = 1;
}

function boolean(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("EXPECTED_VERCEL_PROJECT_PAUSED must be true or false.");
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
