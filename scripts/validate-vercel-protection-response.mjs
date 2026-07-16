#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { assertVercelProtectionResponse } from "../lib/vercel-protection-response.ts";

try {
  const [status, headersFile, expectedRequestUrl, ...extra] = process.argv.slice(2);
  if (!status || !headersFile || !expectedRequestUrl || extra.length > 0) {
    throw new Error(
      "Usage: validate-vercel-protection-response.mjs <status> <headers-file> <expected-request-url>"
    );
  }
  assertVercelProtectionResponse({
    status,
    rawHeaders: readFileSync(headersFile, "utf8"),
    expectedRequestUrl
  });
  console.log("Verified that the generated deployment rejects unauthenticated access.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Vercel protection validation failed.");
  process.exitCode = 1;
}
