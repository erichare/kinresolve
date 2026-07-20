#!/usr/bin/env node
import { performance } from "node:perf_hooks";

// Launch-scale spike gate for the public demo, run against a protected
// generated candidate origin (never the canonical domain). It proves:
//   1. ~200 concurrent landing GETs answer 200 with p95 under 2 seconds;
//   2. once the 25-session capacity is occupied, a session-start storm from
//      one subject fast-429s in under 1 second per attempt with the stateless
//      family/challenge fallbacks and no Set-Cookie;
//   3. no request in the whole exercise produces a 5xx; and
//   4. post-run protected diagnostics report a healthy, fully drained demo.
// Every request carries the canary secret, so the exercise bypasses the
// per-network rate limits and any Turnstile rung and stays out of the human
// KPI funnel.

const canonicalOrigin = "https://demo.kinresolve.com";
const noticeVersion = "public-demo-2026-07-20";
const landingRequestCount = 200;
const landingP95LimitMs = 2_000;
const sessionCount = 25;
const stormRequestCount = 40;
const stormFast429LimitMs = 1_000;
const requestTimeoutMs = 30_000;
const maximumResponseBytes = 256 * 1024;
const safePublicDemoSpikeStages = Object.freeze([
  "configuration",
  "landing-request",
  "landing-response",
  "landing-p95",
  "fill-request",
  "fill-response",
  "storm-request",
  "storm-response",
  "storm-contract",
  "storm-latency",
  "cleanup",
  "diagnostics-response",
  "diagnostics-contract",
  "unknown"
]);

export async function runPublicDemoSpikeTest(
  environment = process.env,
  fetchImplementation = globalThis.fetch
) {
  if (typeof fetchImplementation !== "function") throw spikeGateFailure("configuration");
  let configuration;
  try {
    configuration = resolveConfiguration(environment);
  } catch {
    throw spikeGateFailure("configuration");
  }

  const cookies = [];
  let primaryFailure;
  let result;
  try {
    const landingP95 = await runLandingSpike(configuration, fetchImplementation);
    await fillCapacity(configuration, fetchImplementation, cookies);
    const stormFast429s = await runStartStorm(configuration, fetchImplementation);
    result = Object.freeze({
      landingRequests: landingRequestCount,
      landingP95Milliseconds: Math.ceil(landingP95),
      stormFast429s
    });
  } catch (error) {
    primaryFailure = isSpikeGateFailure(error) ? error : spikeGateFailure("unknown");
  }

  const cleanup = await Promise.allSettled(cookies.map((cookie) => (
    runSpikeStage("cleanup", async () => {
      const response = await request(configuration, fetchImplementation, "/api/demo/session/end", {
        body: "{}",
        cookie,
        method: "POST"
      });
      if (response.status !== 200 && response.status !== 204) {
        throw spikeGateFailure("cleanup", { status: response.status });
      }
    })
  )));
  const cleanupFailed = cleanup.filter(({ status }) => status === "rejected").length;
  if (primaryFailure) {
    throw extendSpikeGateFailure(primaryFailure, "unknown", { cleanupFailed });
  }
  if (cleanupFailed > 0) {
    throw spikeGateFailure("cleanup", {
      attempted: cleanup.length,
      succeeded: cleanup.length - cleanupFailed,
      failed: cleanupFailed,
      cleanupFailed
    });
  }

  await assertHealthyDiagnostics(configuration, fetchImplementation);
  return result;
}

async function runLandingSpike(configuration, fetchImplementation) {
  const landings = await Promise.allSettled(
    Array.from({ length: landingRequestCount }, async () => {
      const startedAt = performance.now();
      const response = await runSpikeStage("landing-request", () => (
        request(configuration, fetchImplementation, "/", { accept: "text/html", method: "GET" })
      ));
      const elapsedMs = performance.now() - startedAt;
      await response.body?.cancel().catch(() => undefined);
      if (response.status !== 200) {
        throw spikeGateFailure("landing-response", { status: response.status });
      }
      return elapsedMs;
    })
  );
  const rejected = landings.filter(({ status }) => status === "rejected");
  if (rejected.length > 0) {
    throw extendSpikeGateFailure(rejected[0].reason, "landing-request", {
      attempted: landingRequestCount,
      succeeded: landingRequestCount - rejected.length,
      failed: rejected.length
    });
  }
  const elapsed = landings
    .map((settled) => settled.value)
    .sort((left, right) => left - right);
  const p95 = elapsed[Math.ceil(elapsed.length * 0.95) - 1];
  if (!Number.isFinite(p95) || p95 > landingP95LimitMs) {
    throw spikeGateFailure("landing-p95", { p95Milliseconds: Math.ceil(p95) });
  }
  return p95;
}

async function fillCapacity(configuration, fetchImplementation, cookies) {
  const starts = await Promise.allSettled(Array.from({ length: sessionCount }, async () => {
    const response = await runSpikeStage("fill-request", () => (
      request(configuration, fetchImplementation, "/api/demo/sessions", {
        body: JSON.stringify({ noticeVersion }),
        method: "POST"
      })
    ));
    if (response.status !== 201) {
      await response.body?.cancel().catch(() => undefined);
      throw spikeGateFailure("fill-response", { status: response.status });
    }
    const cookie = extractCookie(response);
    await response.body?.cancel().catch(() => undefined);
    return cookie;
  }));
  const created = starts.filter(({ status }) => status === "fulfilled");
  cookies.push(...created.map(({ value }) => value));
  const rejected = starts.filter(({ status }) => status === "rejected");
  if (rejected.length > 0) {
    throw extendSpikeGateFailure(rejected[0].reason, "fill-request", {
      attempted: sessionCount,
      succeeded: created.length,
      failed: rejected.length
    });
  }
}

async function runStartStorm(configuration, fetchImplementation) {
  const storm = await Promise.allSettled(Array.from({ length: stormRequestCount }, async () => {
    const startedAt = performance.now();
    const response = await runSpikeStage("storm-request", () => (
      request(configuration, fetchImplementation, "/api/demo/sessions", {
        body: JSON.stringify({ noticeVersion }),
        method: "POST"
      })
    ));
    const elapsedMs = performance.now() - startedAt;
    const retryAfter = response.headers.get("retry-after");
    if (
      response.status !== 429
      || response.redirected
      || response.headers.has("location")
      || response.headers.get("set-cookie") !== null
      || !retryAfter
      || !/^\d+$/.test(retryAfter)
      || Number(retryAfter) < 1
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw spikeGateFailure("storm-response", { status: response.status });
    }
    const document = await runSpikeStage("storm-contract", () => boundedJson(response));
    if (
      document.maximumActiveSessions !== 25
      || document.familyUrl !== "/family"
      || document.challengeUrl !== "/challenge"
      || typeof document.error !== "string"
      || !document.error.includes("at capacity")
    ) {
      throw spikeGateFailure("storm-contract", { status: response.status });
    }
    if (elapsedMs > stormFast429LimitMs) {
      throw spikeGateFailure("storm-latency", {
        p95Milliseconds: Math.ceil(elapsedMs)
      });
    }
    return elapsedMs;
  }));
  const rejected = storm.filter(({ status }) => status === "rejected");
  if (rejected.length > 0) {
    throw extendSpikeGateFailure(rejected[0].reason, "storm-request", {
      attempted: stormRequestCount,
      succeeded: stormRequestCount - rejected.length,
      failed: rejected.length
    });
  }
  return storm.length;
}

async function assertHealthyDiagnostics(configuration, fetchImplementation) {
  const response = await runSpikeStage("diagnostics-response", () => (
    fetchImplementation(new URL("/api/internal/health", configuration.origin), {
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${configuration.probeSecret}`,
        "x-kinresolve-demo-canary": configuration.canarySecret,
        "x-vercel-protection-bypass": configuration.bypassSecret,
        "user-agent": "kinresolve-public-demo-spike-test/1.0"
      },
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(requestTimeoutMs)
    })
  ));
  if (response.status !== 200 || response.redirected || response.headers.has("location")) {
    await response.body?.cancel().catch(() => undefined);
    throw spikeGateFailure("diagnostics-response", { status: response.status });
  }
  const document = await runSpikeStage("diagnostics-contract", () => boundedJson(response));
  const capacity = document?.publicDemo?.capacity;
  if (
    document?.status !== "ok"
    || typeof capacity !== "object"
    || capacity === null
    || capacity.maximum !== 25
    || capacity.occupied !== 0
  ) {
    throw spikeGateFailure("diagnostics-contract", { status: response.status });
  }
}

async function runSpikeStage(stage, operation) {
  try {
    return await operation();
  } catch (error) {
    throw isSpikeGateFailure(error) ? error : spikeGateFailure(stage);
  }
}

function spikeGateFailure(stage, detail = {}) {
  const failure = new Error("The public demo launch spike gate failed.");
  failure.stage = safePublicDemoSpikeStages.includes(stage) ? stage : "unknown";
  failure.status = safeHttpStatus(detail.status);
  failure.attempted = safeSpikeCount(detail.attempted);
  failure.succeeded = safeSpikeCount(detail.succeeded);
  failure.failed = safeSpikeCount(detail.failed);
  failure.p95Milliseconds = safeSpikeMilliseconds(detail.p95Milliseconds);
  failure.cleanupFailed = safeSpikeCount(detail.cleanupFailed);
  return failure;
}

function isSpikeGateFailure(error) {
  return error instanceof Error && safePublicDemoSpikeStages.includes(error.stage);
}

function extendSpikeGateFailure(error, fallbackStage, detail) {
  const failure = isSpikeGateFailure(error) ? error : spikeGateFailure(fallbackStage);
  return spikeGateFailure(failure.stage, {
    status: failure.status,
    attempted: failure.attempted,
    succeeded: failure.succeeded,
    failed: failure.failed,
    p95Milliseconds: failure.p95Milliseconds,
    cleanupFailed: failure.cleanupFailed,
    ...detail
  });
}

function safeHttpStatus(value) {
  return Number.isSafeInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function safeSpikeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 500) : null;
}

function safeSpikeMilliseconds(value) {
  return Number.isFinite(value) && value >= 0 ? Math.min(Math.ceil(value), 60_000) : null;
}

export function safePublicDemoSpikeFailure(error) {
  const candidateStage = safeSpikeDiagnosticProperty(error, "stage");
  const stage = typeof candidateStage === "string" && safePublicDemoSpikeStages.includes(candidateStage)
    ? candidateStage
    : "unknown";
  const details = [
    ["status", safeHttpStatus(safeSpikeDiagnosticProperty(error, "status"))],
    ["attempted", safeSpikeCount(safeSpikeDiagnosticProperty(error, "attempted"))],
    ["succeeded", safeSpikeCount(safeSpikeDiagnosticProperty(error, "succeeded"))],
    ["failed", safeSpikeCount(safeSpikeDiagnosticProperty(error, "failed"))],
    ["p95Milliseconds", safeSpikeMilliseconds(
      safeSpikeDiagnosticProperty(error, "p95Milliseconds")
    )],
    ["cleanupFailed", safeSpikeCount(safeSpikeDiagnosticProperty(error, "cleanupFailed"))]
  ].flatMap(([name, value]) => value === null ? [] : [`${name}=${value}`]);
  return `Public demo launch spike gate failed. stage=${stage}${
    details.length > 0 ? ` ${details.join(" ")}` : ""
  }`;
}

function safeSpikeDiagnosticProperty(value, property) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }
  try {
    return Reflect.get(value, property);
  } catch {
    return undefined;
  }
}

async function request(configuration, fetchImplementation, pathname, options) {
  const mutation = options.method !== "GET" && options.method !== "HEAD";
  return fetchImplementation(new URL(pathname, configuration.origin), {
    body: options.body,
    cache: "no-store",
    headers: {
      accept: options.accept ?? "application/json",
      ...(mutation ? { "content-type": "application/json" } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      "x-kinresolve-demo-canary": configuration.canarySecret,
      "x-vercel-protection-bypass": configuration.bypassSecret,
      ...(mutation ? {
        origin: canonicalOrigin,
        "sec-fetch-site": "same-origin"
      } : {})
    },
    method: options.method,
    redirect: "manual",
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
}

function extractCookie(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  const cookies = values
    .map((value) => value.split(";", 1)[0]?.trim())
    .filter((value) => value?.startsWith("__Host-kinresolve-demo="));
  if (cookies.length !== 1 || !/^__Host-kinresolve-demo=[A-Za-z0-9_-]{43,256}$/.test(cookies[0])) {
    throw new Error("A spike-test session cookie was invalid.");
  }
  return cookies[0];
}

async function boundedJson(response) {
  const contents = await boundedText(response);
  const value = JSON.parse(contents);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("A spike-test response was not a JSON object.");
  }
  return value;
}

async function boundedText(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumResponseBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("A spike-test response exceeded its size bound.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function resolveConfiguration(environment) {
  const origin = exactCandidateOrigin(environment.PUBLIC_DEMO_ORIGIN);
  return Object.freeze({
    origin,
    canarySecret: requiredSecret(environment.KINRESOLVE_DEMO_CANARY_SECRET),
    bypassSecret: requiredSecret(environment.VERCEL_AUTOMATION_BYPASS_SECRET),
    probeSecret: requiredSecret(environment.KINRESOLVE_OBSERVABILITY_PROBE_SECRET)
  });
}

function exactCandidateOrigin(value) {
  if (typeof value !== "string" || value.trim() !== value) {
    throw new Error("The spike-test origin is invalid.");
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || url.origin !== value
    || !url.hostname.endsWith(".vercel.app")
    || url.hostname === "vercel.app"
    || url.username
    || url.password
    || url.port
  ) {
    throw new Error("The spike test requires a protected generated candidate origin.");
  }
  return url.origin;
}

function requiredSecret(value) {
  if (typeof value !== "string" || value.trim() !== value || !/^[A-Za-z0-9_-]{20,256}$/.test(value)) {
    throw new Error("A spike-test credential is invalid.");
  }
  return value;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  runPublicDemoSpikeTest().then((result) => {
    console.log(
      `Public demo launch spike gate passed. landingP95Milliseconds=${result.landingP95Milliseconds} `
        + `stormFast429s=${result.stormFast429s}`
    );
  }).catch((error) => {
    console.error(safePublicDemoSpikeFailure(error));
    process.exitCode = 1;
  });
}
