#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const canonicalOrigin = "https://demo.kinresolve.com";
const maximumResponseBytes = 256 * 1024;
const requestTimeoutMs = 30_000;
const maximumCleanupAgeMs = 10 * 60 * 1000;
const cleanupLeaseDurationMs = 4 * 60 * 1000;
const maximumClockSkewMs = 60 * 1000;

export async function runPublicDemoInternalHealthMonitor(
  environment = process.env,
  fetchImplementation = globalThis.fetch
) {
  if (typeof fetchImplementation !== "function") {
    throw new Error("The protected demo health monitor requires fetch.");
  }
  const configuration = resolveConfiguration(environment);
  const response = await fetchImplementation(
    new URL("/api/internal/health", configuration.origin),
    {
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${configuration.probeSecret}`,
        "user-agent": "kinresolve-public-demo-internal-health-monitor/1.0",
        ...(configuration.bypassSecret
          ? { "x-vercel-protection-bypass": configuration.bypassSecret }
          : {})
      },
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(requestTimeoutMs)
    }
  );
  if (
    response.status !== 200
    || response.redirected
    || response.headers.has("location")
    || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")
    || !response.headers.get("cache-control")?.toLowerCase().split(",").map((value) => value.trim()).includes("no-store")
  ) {
    throw healthError();
  }

  const document = await boundedJson(response);
  const diagnostics = validateDiagnostics(
    document,
    configuration.expectedRuntimeRoleIdentitySha256
  );
  await proveCronSecretConfigured(configuration, fetchImplementation);
  return Object.freeze({
    active: diagnostics.capacity.active,
    occupied: diagnostics.capacity.occupied,
    dailyAiUsed: diagnostics.aiBudget.dailyUsed
  });
}

async function proveCronSecretConfigured(configuration, fetchImplementation) {
  const response = await fetchImplementation(
    new URL("/api/cron/integration-jobs", configuration.origin),
    {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "user-agent": "kinresolve-public-demo-internal-health-monitor/1.0",
        ...(configuration.bypassSecret
          ? { "x-vercel-protection-bypass": configuration.bypassSecret }
          : {})
      },
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(requestTimeoutMs)
    }
  );
  if (
    response.status !== 401
    || response.redirected
    || response.headers.has("location")
    || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")
  ) {
    throw healthError();
  }
  const document = await boundedJson(response);
  if (
    !objectValue(document)
    || Object.keys(document).length !== 1
    || document.error !== "Unauthorized"
  ) {
    throw healthError();
  }
}

function validateDiagnostics(document, expectedRuntimeRoleIdentitySha256) {
  const database = objectValue(document?.database);
  const diagnostics = objectValue(document?.publicDemo);
  const capacity = objectValue(diagnostics?.capacity);
  const cleanup = objectValue(diagnostics?.cleanup);
  const aiBudget = objectValue(diagnostics?.aiBudget);
  const now = Date.now();
  const healthyCleanup = validHealthyCleanup(cleanup, now);
  const runningCleanup = validRunningCleanup(cleanup, now);

  if (
    document?.status !== "ok"
    || !database
    || typeof database.runtimeRoleIdentitySha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(database.runtimeRoleIdentitySha256)
    || (expectedRuntimeRoleIdentitySha256 !== null
      && database.runtimeRoleIdentitySha256 !== expectedRuntimeRoleIdentitySha256)
    || !capacity
    || !cleanup
    || !aiBudget
    || capacity.maximum !== 25
    || !nonnegativeInteger(capacity.active)
    || !nonnegativeInteger(capacity.provisioning)
    || !nonnegativeInteger(capacity.occupied)
    || capacity.occupied !== capacity.active + capacity.provisioning
    || capacity.occupied > capacity.maximum
    || (!healthyCleanup && !runningCleanup)
    || diagnostics.staleProvisioning !== 0
    || aiBudget.concurrentLimit !== 5
    || !nonnegativeInteger(aiBudget.running)
    || aiBudget.running > aiBudget.concurrentLimit
    || aiBudget.dailyLimit !== 150
    || !nonnegativeInteger(aiBudget.dailyUsed)
    || aiBudget.dailyUsed > aiBudget.dailyLimit
  ) {
    throw healthError();
  }
  return { capacity, aiBudget };
}

function validHealthyCleanup(cleanup, now) {
  if (
    cleanup?.freshness !== "healthy"
    || cleanup.leaseHeld !== false
    || typeof cleanup.lastCompletedAt !== "string"
    || cleanup.lastFailedAt !== null
  ) return false;
  const completedAt = Date.parse(cleanup.lastCompletedAt);
  return Number.isFinite(completedAt)
    && completedAt <= now + maximumClockSkewMs
    && now - completedAt <= maximumCleanupAgeMs;
}

function validRunningCleanup(cleanup, now) {
  if (
    cleanup?.freshness !== "running"
    || cleanup.leaseHeld !== true
    || typeof cleanup.lastStartedAt !== "string"
    || cleanup.lastCompletedAt !== null
    || cleanup.lastFailedAt !== null
  ) return false;
  const startedAt = Date.parse(cleanup.lastStartedAt);
  const age = now - startedAt;
  return Number.isFinite(startedAt)
    && age >= -maximumClockSkewMs
    && age <= cleanupLeaseDurationMs;
}

function resolveConfiguration(environment) {
  const origin = exactOrigin(environment.PUBLIC_DEMO_ORIGIN);
  const candidate = new URL(origin).hostname.endsWith(".vercel.app")
    && new URL(origin).hostname !== "vercel.app";
  const bypassSecret = optionalSecret(environment.VERCEL_AUTOMATION_BYPASS_SECRET);
  if (origin !== canonicalOrigin && (!candidate || !bypassSecret)) {
    throw new Error("The protected health origin is not an approved demo origin.");
  }
  return Object.freeze({
    origin,
    bypassSecret,
    expectedRuntimeRoleIdentitySha256: optionalDigest(
      environment.EXPECTED_RUNTIME_ROLE_IDENTITY_SHA256
    ),
    probeSecret: requiredSecret(
      environment.KINRESOLVE_OBSERVABILITY_PROBE_SECRET,
      "KINRESOLVE_OBSERVABILITY_PROBE_SECRET"
    )
  });
}

function optionalDigest(value) {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("The expected runtime role identity is malformed.");
  }
  return value;
}

function exactOrigin(value) {
  if (typeof value !== "string" || value.trim() !== value) {
    throw new Error("PUBLIC_DEMO_ORIGIN is invalid.");
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || url.origin !== value
    || url.username
    || url.password
    || url.port
  ) {
    throw new Error("PUBLIC_DEMO_ORIGIN is invalid.");
  }
  return url.origin;
}

function requiredSecret(value, name) {
  const secret = optionalSecret(value);
  if (!secret) throw new Error(`${name} is required.`);
  return secret;
}

function optionalSecret(value) {
  if (value === undefined || value === "") return null;
  if (
    typeof value !== "string"
    || value.trim() !== value
    || !/^[A-Za-z0-9_-]{20,256}$/.test(value)
  ) {
    throw new Error("A protected demo health credential is malformed.");
  }
  return value;
}

async function boundedJson(response) {
  if (!response.body) throw healthError();
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumResponseBytes) throw healthError();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw healthError();
  }
}

function objectValue(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function nonnegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function healthError() {
  return new Error("The public demo operational health contract failed.");
}

async function main() {
  if (process.argv.length !== 2) throw new Error("Unexpected protected health monitor arguments.");
  await runPublicDemoInternalHealthMonitor();
  console.log("Protected public demo health monitor passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Protected public demo health monitor failed.");
    process.exitCode = 1;
  });
}
