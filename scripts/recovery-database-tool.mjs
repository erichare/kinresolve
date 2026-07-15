#!/usr/bin/env node
import { spawn } from "node:child_process";
import { chmod } from "node:fs/promises";

import { Pool } from "pg";

import { getDatabaseConnectionString, isDatabaseTransportVerified } from "../lib/connection-string.ts";
import {
  assertSupabaseDatabaseProjectBinding,
  readDatabaseIdentity,
  validateConfiguredDatabaseIdentity
} from "../lib/database-attestation.ts";
import { buildRecoveryDatabaseCommand } from "../lib/recovery-database-command.ts";

try {
  const [operation, filePath, ...unexpected] = process.argv.slice(2);
  if (!["dump", "restore"].includes(operation) || !filePath || unexpected.length > 0) {
    throw new Error("Usage: recovery-database-tool.mjs <dump|restore> <database.dump>.");
  }
  const databaseUrl = required("RECOVERY_DATABASE_URL");
  if (!isDatabaseTransportVerified(databaseUrl)) {
    throw new Error("The recovery database tool requires a verified TLS connection.");
  }
  if (new URL(databaseUrl).port === "6543") {
    throw new Error("The recovery database tool must not use a transaction pooler.");
  }
  const connectionString = getDatabaseConnectionString(databaseUrl);
  if (operation === "restore") {
    assertSupabaseDatabaseProjectBinding(
      databaseUrl,
      required("RECOVERY_TARGET_SUPABASE_PROJECT_REF")
    );
    await assertDisposableTarget(connectionString);
  }
  const invocation = buildRecoveryDatabaseCommand(operation, filePath, connectionString);
  let code;
  try {
    code = await run(invocation.command, invocation.args, invocation.env);
  } catch {
    throw new Error(`The recovery database ${operation} command failed.`);
  }
  if (code !== 0) throw new Error(`The recovery database ${operation} command failed.`);
  if (operation === "dump") await chmod(filePath, 0o600);
  console.log(`Completed the recovery database ${operation}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Recovery database tool failed.");
  process.exitCode = 1;
}

async function assertDisposableTarget(connectionString) {
  if (required("RECOVERY_TARGET_DATABASE_REPLACEMENT_POLICY") !== "identity-bound-disposable-v1") {
    throw new Error("The recovery target database is not approved for destructive replacement.");
  }
  const expectedTargetIdentity = required("EXPECTED_DATABASE_IDENTITY");
  const productionIdentity = required("KINRESOLVE_DATABASE_IDENTITY");
  if (expectedTargetIdentity === productionIdentity) {
    throw new Error("The destructive recovery target must not be the production database.");
  }
  const pool = new Pool({ connectionString, max: 1 });
  try {
    validateConfiguredDatabaseIdentity(expectedTargetIdentity, await readDatabaseIdentity(pool));
  } finally {
    await pool.end();
  }
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "ignore" });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (signal) reject(new Error(`The recovery database command ended from signal ${signal}.`));
      else resolve(code ?? 1);
    });
  });
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
