#!/usr/bin/env node
import { chmod, readFile, writeFile } from "node:fs/promises";

import { validateSupabaseRecoveryPoint } from "../lib/recovery-evidence-operations.ts";

try {
  const [responsePath, outputPath, ...unexpected] = process.argv.slice(2);
  if (!responsePath || !outputPath || unexpected.length > 0) {
    throw new Error("Usage: validate-supabase-recovery-point.mjs <response.json> <output.json>.");
  }
  const projectRef = required("SUPABASE_PROJECT_REF");
  const databaseUrl = required("RECOVERY_DATABASE_URL");
  assertSupabaseProjectBinding(databaseUrl, projectRef);
  let response;
  try {
    response = JSON.parse(await readFile(responsePath, "utf8"));
  } catch {
    throw new Error("The Supabase recovery-point response is missing or invalid JSON.");
  }
  const result = validateSupabaseRecoveryPoint(response);
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(outputPath, 0o600);
  console.log("Validated a fresh provider recovery point for the source database project.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Supabase recovery-point validation failed.");
  process.exitCode = 1;
}

function assertSupabaseProjectBinding(databaseUrl, projectRef) {
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("SUPABASE_PROJECT_REF is invalid.");
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("RECOVERY_DATABASE_URL is invalid.");
  }
  const direct = parsed.hostname.toLowerCase() === `db.${projectRef}.supabase.co`;
  const pooler = parsed.hostname.toLowerCase().endsWith(".pooler.supabase.com")
    && decodeURIComponent(parsed.username) === `postgres.${projectRef}`;
  if (!direct && !pooler) {
    throw new Error("SUPABASE_PROJECT_REF does not match RECOVERY_DATABASE_URL.");
  }
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
