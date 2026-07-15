#!/usr/bin/env node
import { lstat, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  resolveStaticHoldingOutput,
  serializeStaticHoldingConfig,
  staticHoldingOutputFiles
} from "./static-holding-contract.mjs";

try {
  const outputDirectory = resolveStaticHoldingOutput(process.argv.slice(2));
  const actualFiles = await listRegularFiles(outputDirectory);
  if (JSON.stringify(actualFiles) !== JSON.stringify(staticHoldingOutputFiles)) {
    throw new Error("The artifact contains unexpected output; only checked-in static files are allowed.");
  }

  const actualConfig = await readFile(path.join(outputDirectory, "config.json"), "utf8");
  if (actualConfig !== serializeStaticHoldingConfig()) {
    throw new Error("The Vercel Build Output API configuration does not match the static holding contract.");
  }

  const sourcePath = fileURLToPath(new URL("../holding/login.html", import.meta.url));
  const [sourceHtml, outputHtml] = await Promise.all([
    readFile(sourcePath),
    readFile(path.join(outputDirectory, "static", "login.html"))
  ]);
  if (!sourceHtml.equals(outputHtml)) {
    throw new Error("The deployed holding page does not match the checked-in source.");
  }

  console.log("Static holding artifact verified: two static files, zero runtime functions.");
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown verification failure.";
  console.error(`Static holding verification failed: ${message}`);
  process.exitCode = 1;
}

async function listRegularFiles(root) {
  const files = [];
  await visit("");
  return files.sort();

  async function visit(relativeDirectory) {
    const directory = path.join(root, relativeDirectory);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      const absolutePath = path.join(root, relativePath);
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        throw new Error("The static holding artifact may not contain symbolic links.");
      }
      if (stats.isDirectory()) {
        await visit(relativePath);
      } else if (stats.isFile()) {
        files.push(relativePath);
      } else {
        throw new Error("The static holding artifact may contain only directories and regular files.");
      }
    }
  }
}
