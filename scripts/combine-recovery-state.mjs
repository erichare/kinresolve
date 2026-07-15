#!/usr/bin/env node
import { chmod, readFile, writeFile } from "node:fs/promises";

import { combineRecoveryStateDigest } from "../lib/recovery-evidence-operations.ts";

try {
  const [databasePath, objectsPath, outputPath, ...unexpected] = process.argv.slice(2);
  if (!databasePath || !objectsPath || !outputPath || unexpected.length > 0) {
    throw new Error("Usage: combine-recovery-state.mjs <database.json> <objects.json> <output.json>.");
  }
  const database = await json(databasePath);
  const objects = await json(objectsPath);
  const stateDigest = combineRecoveryStateDigest({
    databaseManifestSha256: database.manifestSha256,
    objectNamespaces: objects.objectNamespaces
  });
  await writeFile(outputPath, `${JSON.stringify({ stateDigest }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(outputPath, 0o600);
  console.log("Combined recovery state digest.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Recovery state combination failed.");
  process.exitCode = 1;
}

async function json(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error("A recovery state input is missing or invalid JSON.");
  }
}
