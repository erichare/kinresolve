#!/usr/bin/env node
import { chmod, writeFile } from "node:fs/promises";

try {
  const [outputPath, ...unexpected] = process.argv.slice(2);
  if (!outputPath || unexpected.length > 0) throw new Error("Usage: record-recovery-time.mjs <output.txt>.");
  await writeFile(outputPath, `${new Date().toISOString()}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(outputPath, 0o600);
  console.log("Recorded a machine recovery timestamp.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Recovery timestamp capture failed.");
  process.exitCode = 1;
}
