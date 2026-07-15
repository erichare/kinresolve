#!/usr/bin/env node
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const endpoints = [
  { slug: "import-uploads", path: "/api/cron/import-uploads" },
  { slug: "integration-jobs", path: "/api/cron/integration-jobs" }
];

try {
  const [probeDirectory, fencePath, outputPath, ...unexpected] = process.argv.slice(2);
  if (!probeDirectory || !fencePath || !outputPath || unexpected.length > 0) {
    throw new Error("Usage: validate-fenced-cron-probes.mjs <probe-directory> <fence.json> <output.json>.");
  }
  const fence = await json(fencePath, "acquired fence");
  const result = [];
  for (const endpoint of endpoints) {
    const statusText = (await readFile(path.join(probeDirectory, `${endpoint.slug}.status`), "utf8")).trim();
    const body = await json(path.join(probeDirectory, `${endpoint.slug}.json`), "cron fence response");
    const headers = (await readFile(path.join(probeDirectory, `${endpoint.slug}.headers`), "utf8")).toLowerCase();
    if (statusText !== "423") throw new Error(`${endpoint.path} did not return HTTP 423.`);
    if (
      JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(["error", "fenceId", "releaseCommitSha"])
      || body.error !== "Writes are temporarily paused for release safety"
      || body.fenceId !== fence.fenceId
      || body.releaseCommitSha !== fence.releaseCommitSha
    ) {
      throw new Error(`${endpoint.path} did not return the exact active fence identity.`);
    }
    if (
      !/(?:^|\r?\n)content-type:\s*application\/json(?:;|\r?$)/m.test(headers)
      || !/(?:^|\r?\n)cache-control:\s*private, no-store\r?$/m.test(headers)
    ) {
      throw new Error(`${endpoint.path} did not return private, no-store JSON.`);
    }
    result.push({ path: endpoint.path, status: 423, fenceId: fence.fenceId });
  }
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(outputPath, 0o600);
  console.log("Validated both authenticated cron endpoints as fenced.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Fenced cron validation failed.");
  process.exitCode = 1;
}

async function json(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error(`The ${label} is missing or invalid JSON.`);
  }
}
