#!/usr/bin/env node
import { chmod, writeFile } from "node:fs/promises";

import { Pool } from "pg";

import { getDatabaseConnectionString, isDatabaseTransportVerified } from "../lib/connection-string.ts";
import {
  assertSupabaseDatabaseProjectBinding,
  readDatabaseIdentity,
  validateConfiguredDatabaseIdentity
} from "../lib/database-attestation.ts";

try {
  const [outputPath, ...unexpected] = process.argv.slice(2);
  if (!outputPath || unexpected.length > 0) {
    throw new Error("Usage: destroy-recovery-database-target.mjs <output.json>.");
  }
  const targetToken = required("RECOVERY_TARGET_SUPABASE_ACCESS_TOKEN");
  const sourceProjectRef = projectRef(required("SUPABASE_PROJECT_REF"));
  const targetProjectRef = projectRef(required("RECOVERY_TARGET_SUPABASE_PROJECT_REF"));
  const requireExisting = boolean(process.env.RECOVERY_TARGET_DESTRUCTION_REQUIRE_EXISTING ?? "true");
  const verifySource = boolean(process.env.RECOVERY_TARGET_DESTRUCTION_VERIFY_SOURCE ?? "true");
  if (sourceProjectRef === targetProjectRef) {
    throw new Error("The disposable recovery target project must not be the production source project.");
  }
  const apiBaseUrl = managementApiBaseUrl();
  const targetHeaders = { Authorization: `Bearer ${targetToken}`, Accept: "application/json" };
  const sourceToken = verifySource ? required("SUPABASE_ACCESS_TOKEN") : undefined;
  if (sourceToken === targetToken) {
    throw new Error("Source-read and target-destruction provider credentials must be distinct.");
  }
  const sourceHeaders = sourceToken
    ? { Authorization: `Bearer ${sourceToken}`, Accept: "application/json" }
    : undefined;
  if (sourceHeaders) await requireProject(apiBaseUrl, sourceProjectRef, sourceHeaders, "source");

  const targetResponse = await request(`${apiBaseUrl}/v1/projects/${targetProjectRef}`, { headers: targetHeaders });
  let deletionRequested = false;
  if (targetResponse.status === 404) {
    if (requireExisting) {
      throw new Error("The disposable recovery target project disappeared before its required deletion request.");
    }
  } else {
    await requireProjectResponse(targetResponse, targetProjectRef, "target");
    await assertTargetDatabase(targetProjectRef);
    const deletionResponse = await request(`${apiBaseUrl}/v1/projects/${targetProjectRef}`, {
      method: "DELETE",
      headers: targetHeaders
    });
    if (deletionResponse.status !== 200) {
      throw new Error("The recovery target provider did not accept the exact project deletion request.");
    }
    const deletedProject = await responseJson(deletionResponse, "project deletion");
    if (deletedProject.ref !== targetProjectRef) {
      throw new Error("The recovery target provider deletion response does not match the disposable project.");
    }
    deletionRequested = true;
  }

  const pollAttempts = testTunableInteger("RECOVERY_TARGET_DELETION_POLL_ATTEMPTS", 60, 1, 120);
  const pollIntervalMs = testTunableInteger("RECOVERY_TARGET_DELETION_POLL_INTERVAL_MS", 10_000, 0, 60_000);
  let destroyed = false;
  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    const response = await request(`${apiBaseUrl}/v1/projects/${targetProjectRef}`, { headers: targetHeaders });
    if (response.status === 404) {
      destroyed = true;
      break;
    }
    await requireProjectResponse(response, targetProjectRef, "target deletion poll");
    if (attempt + 1 < pollAttempts) await delay(pollIntervalMs);
  }
  if (!destroyed) {
    throw new Error("The recovery target provider did not prove project deletion within the bounded poll window.");
  }
  if (sourceHeaders) {
    await requireProject(apiBaseUrl, sourceProjectRef, sourceHeaders, "source after target deletion");
  }

  await writeFile(outputPath, `${JSON.stringify({
    schemaVersion: 1,
    provider: "supabase",
    sourceProjectRef,
    targetProjectRef,
    deletionRequested,
    sourceProjectRetained: verifySource,
    targetDatabaseDestroyed: true,
    verifiedAt: new Date().toISOString()
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(outputPath, 0o600);
  console.log("Verified destruction of the exact disposable recovery database target.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Recovery target database destruction failed.");
  process.exitCode = 1;
}

async function requireProject(apiBaseUrl, ref, headers, label) {
  const response = await request(`${apiBaseUrl}/v1/projects/${ref}`, { headers });
  await requireProjectResponse(response, ref, label);
}

async function assertTargetDatabase(targetProjectRef) {
  const databaseUrl = required("RECOVERY_TARGET_DATABASE_URL");
  const expectedIdentity = required("RECOVERY_TARGET_DATABASE_IDENTITY");
  if (!isDatabaseTransportVerified(databaseUrl) || new URL(databaseUrl).port === "6543") {
    throw new Error("The disposable recovery target database connection is not a verified direct/session connection.");
  }
  assertSupabaseDatabaseProjectBinding(databaseUrl, targetProjectRef);
  const pool = new Pool({ connectionString: getDatabaseConnectionString(databaseUrl), max: 1 });
  try {
    validateConfiguredDatabaseIdentity(expectedIdentity, await readDatabaseIdentity(pool));
  } finally {
    await pool.end();
  }
}

async function requireProjectResponse(response, ref, label) {
  if (response.status !== 200) {
    throw new Error(`The recovery provider did not return the expected ${label} project.`);
  }
  const project = await responseJson(response, label);
  if (project.ref !== ref) {
    throw new Error(`The recovery provider ${label} project identity does not match.`);
  }
}

async function request(url, init) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(45_000) });
  } catch {
    throw new Error("The recovery target provider request failed.");
  }
}

async function responseJson(response, label) {
  try {
    const value = await response.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error(`The recovery provider ${label} response is invalid.`);
  }
}

function managementApiBaseUrl() {
  const configured = process.env.RECOVERY_SUPABASE_MANAGEMENT_API_BASE_URL?.trim();
  if (!configured) return "https://api.supabase.com";
  if (process.env.NODE_ENV !== "test") {
    throw new Error("A custom recovery provider API origin is allowed only in tests.");
  }
  const parsed = new URL(configured);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== configured) {
    throw new Error("The recovery provider API test origin is invalid.");
  }
  return configured;
}

function testTunableInteger(name, fallback, minimum, maximum) {
  const configured = process.env[name]?.trim();
  if (!configured) return fallback;
  if (process.env.NODE_ENV !== "test" || !/^\d+$/.test(configured)) {
    throw new Error("Recovery provider poll tuning is allowed only in tests.");
  }
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error("A recovery provider poll setting is out of range.");
  }
  return value;
}

function projectRef(value) {
  if (!/^[a-z0-9]{20}$/.test(value)) throw new Error("A recovery Supabase project ref is invalid.");
  return value;
}

function boolean(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("A recovery target destruction boolean must be true or false.");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
