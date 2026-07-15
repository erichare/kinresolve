#!/usr/bin/env node
import { chmod, readFile, writeFile } from "node:fs/promises";

try {
  const [phase, responsePath, outputPath, acquiredPath, ...unexpected] = process.argv.slice(2);
  if (
    !["acquire", "assert"].includes(phase)
    || !responsePath
    || !outputPath
    || unexpected.length > 0
    || (phase === "assert" && !acquiredPath)
    || (phase === "acquire" && acquiredPath)
  ) {
    throw new Error(
      "Usage: validate-recovery-fence-response.mjs acquire <response.json> <output.json> OR assert <response.json> <output.json> <acquired.json>."
    );
  }
  const response = await json(responsePath, "release fence response");
  const expectedFenceId = required("RECOVERY_FENCE_ID");
  const expectedReleaseCommit = required("RELEASE_COMMIT");
  const keys = [
    "activatedAt", "activationGeneration", "active", "fenceId", "releaseCommitSha", "released", "transition"
  ].sort();
  if (JSON.stringify(Object.keys(response).sort()) !== JSON.stringify(keys)) {
    throw new Error("The release fence response does not match its strict machine schema.");
  }
  if (
    response.fenceId !== expectedFenceId
    || response.releaseCommitSha !== expectedReleaseCommit
    || response.active !== true
    || response.released !== false
    || !Number.isSafeInteger(response.activationGeneration)
    || response.activationGeneration < 1
  ) {
    throw new Error("The release fence response does not attest the requested active fence.");
  }
  exactTimestamp(response.activatedAt, "release fence activatedAt");
  if (phase === "acquire" && !["acquired", "already-active"].includes(response.transition)) {
    throw new Error("Recovery evidence requires a new or exact active recovery fence.");
  }
  if (phase === "assert" && response.transition !== "asserted") {
    throw new Error("The final release fence response must be an assertion.");
  }
  if (phase === "assert") {
    const acquired = await json(acquiredPath, "acquired release fence");
    if (
      acquired.fenceId !== response.fenceId
      || acquired.releaseCommitSha !== response.releaseCommitSha
      || acquired.activatedAt !== response.activatedAt
      || acquired.activationGeneration !== response.activationGeneration
      || !["acquired", "already-active"].includes(acquired.transition)
    ) {
      throw new Error("The asserted fence is not the exact activation used for recovery evidence.");
    }
  }
  await writeFile(outputPath, `${JSON.stringify(response, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(outputPath, 0o600);
  console.log(`Validated the machine-derived release fence ${phase} response.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Release fence response validation failed.");
  process.exitCode = 1;
}

async function json(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error(`The ${label} is missing or invalid JSON.`);
  }
}

function exactTimestamp(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error(`The ${label} must be an exact UTC timestamp.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`The ${label} must be a real UTC timestamp.`);
  }
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
