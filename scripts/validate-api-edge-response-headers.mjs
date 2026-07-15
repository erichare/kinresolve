#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { validateApiEdgeResponseHeaders } from "../lib/api-edge-response-headers.ts";

try {
  const [policy, filePath, ...unexpected] = process.argv.slice(2);
  if (
    !["ordinary", "rate-limited", "direct-protection", "canonical"].includes(policy)
    || !filePath
    || unexpected.length > 0
  ) {
    throw new Error("Invalid response-header validation arguments.");
  }
  validateApiEdgeResponseHeaders(await readFile(filePath, "utf8"), policy);
  console.log("API edge response headers passed.");
} catch {
  console.error("API edge response headers failed.");
  process.exitCode = 1;
}
