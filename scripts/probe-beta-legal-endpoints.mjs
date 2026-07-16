#!/usr/bin/env node
import { probeBetaLegalEndpoints } from "../lib/beta-legal-endpoint-probe.ts";

try {
  const [origin, ...unexpected] = process.argv.slice(2);
  if (!origin || unexpected.length > 0) {
    throw new Error("Usage: probe-beta-legal-endpoints.mjs <https-origin>.");
  }
  const results = await probeBetaLegalEndpoints({
    origin,
    environment: process.env,
    bypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  });
  for (const result of results) {
    console.log(`${result.document}: ${result.status}.`);
  }
} catch {
  console.error("Live beta legal endpoint proof failed.");
  process.exitCode = 1;
}
