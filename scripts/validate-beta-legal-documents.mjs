#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

import {
  BetaLegalDocumentValidationError,
  validateApprovedBetaLegalDocuments
} from "../lib/beta-legal-document-validation.ts";
import { loadApprovedBetaLegalManifest } from "../lib/beta-legal-manifest.ts";

const defaultEnvironmentPath = ".vercel/.env.production.local";

try {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length > 1) throw new Error("Invalid command arguments.");
  const environmentContents = await readFile(arguments_[0] ?? defaultEnvironmentPath, "utf8");
  const environment = parseEnv(environmentContents);
  const manifest = loadApprovedBetaLegalManifest(environment);
  const results = await validateApprovedBetaLegalDocuments(manifest);
  for (const result of results) {
    console.log(`${result.title}: ${result.status}.`);
  }
} catch (error) {
  console.error(
    error instanceof BetaLegalDocumentValidationError
      ? error.message
      : "Private beta legal document validation failed."
  );
  process.exitCode = 1;
}
