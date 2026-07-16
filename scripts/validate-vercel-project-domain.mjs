#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { validateVercelProjectDomain } from "../lib/vercel-project-domain.ts";

try {
  const [filePath, ...unexpected] = process.argv.slice(2);
  if (!filePath || unexpected.length > 0) {
    throw new Error("Usage: validate-vercel-project-domain.mjs <domain.json>.");
  }
  const result = validateVercelProjectDomain(
    JSON.parse(await readFile(filePath, "utf8")),
    {
      expectedDomain: required("EXPECTED_VERCEL_DOMAIN"),
      expectedProjectId: required("VERCEL_PROJECT_ID")
    }
  );
  process.stdout.write(
    `domain=${result.domain}\nproject_id=${result.projectId}\nverified=true\n`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Vercel project-domain validation failed.");
  process.exitCode = 1;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
