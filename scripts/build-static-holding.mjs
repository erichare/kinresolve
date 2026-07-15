#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  resolveStaticHoldingOutput,
  serializeStaticHoldingConfig
} from "./static-holding-contract.mjs";

try {
  const outputDirectory = resolveStaticHoldingOutput(process.argv.slice(2));
  const sourcePath = fileURLToPath(new URL("../holding/login.html", import.meta.url));
  const html = await readFile(sourcePath);

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(path.join(outputDirectory, "static"), { recursive: true, mode: 0o755 });
  await writeFile(path.join(outputDirectory, "config.json"), serializeStaticHoldingConfig(), {
    encoding: "utf8",
    mode: 0o644
  });
  await writeFile(path.join(outputDirectory, "static", "login.html"), html, { mode: 0o644 });

  console.log("Deterministic static holding artifact built.");
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown build failure.";
  console.error(`Static holding build failed: ${message}`);
  process.exitCode = 1;
}
