#!/usr/bin/env node
import { performance } from "node:perf_hooks";

const canonicalOrigin = "https://demo.kinresolve.com";
const guidedPath = "/app/cases/case-mercer-march-identity?guide=1";
const noticeVersion = "public-demo-2026-07-16";
const sessionCount = 25;
const p95LimitMs = 5_000;
const requestTimeoutMs = 30_000;
const maximumResponseBytes = 256 * 1024;

export async function runPublicDemoLoadTest(
  environment = process.env,
  fetchImplementation = globalThis.fetch
) {
  if (typeof fetchImplementation !== "function") throw new Error("The load test requires fetch.");
  const configuration = resolveConfiguration(environment);
  const cookies = [];
  try {
    const starts = await Promise.allSettled(Array.from({ length: sessionCount }, async () => {
      const startedAt = performance.now();
      const response = await request(configuration, fetchImplementation, "/api/demo/sessions", {
        body: JSON.stringify({ noticeVersion }),
        method: "POST"
      });
      const elapsedMs = performance.now() - startedAt;
      if (response.status !== 201) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error("A simultaneous demo start was rejected.");
      }
      const cookie = extractCookie(response);
      let bodyValid = false;
      try {
        const document = await boundedJson(response);
        bodyValid = document.workspaceUrl === guidedPath;
      } catch {
        // Preserve the cookie so the finally block can still end this session.
      }
      return { bodyValid, cookie, elapsedMs };
    }));
    const created = starts
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    cookies.push(...created.map(({ cookie }) => cookie));
    if (starts.some(({ status }) => status === "rejected")) {
      throw new Error("The 25-session demo capacity gate failed.");
    }
    if (created.some(({ bodyValid }) => !bodyValid)) {
      throw new Error("A simultaneous demo start returned an invalid body.");
    }
    if (new Set(cookies).size !== sessionCount) {
      throw new Error("The capacity gate did not issue unique demo cookies.");
    }

    const elapsed = created.map(({ elapsedMs }) => elapsedMs).sort((left, right) => left - right);
    const p95 = elapsed[Math.ceil(elapsed.length * 0.95) - 1];
    if (!Number.isFinite(p95) || p95 > p95LimitMs) {
      throw new Error("The demo session-creation p95 exceeded five seconds.");
    }

    const reads = await Promise.allSettled(cookies.flatMap((cookie) => [
      readSession(configuration, fetchImplementation, cookie),
      readGuidedPage(configuration, fetchImplementation, cookie)
    ]));
    if (reads.some(({ status }) => status === "rejected")) {
      throw new Error("The 25-session core-read gate failed.");
    }
    return Object.freeze({ sessionCount, p95Milliseconds: Math.ceil(p95) });
  } finally {
    const cleanup = await Promise.allSettled(cookies.map((cookie) => (
      request(configuration, fetchImplementation, "/api/demo/session/end", {
        body: "{}",
        cookie,
        method: "POST"
      }).then((response) => {
        if (response.status !== 200 && response.status !== 204) {
          throw new Error("A load-test demo session could not be ended.");
        }
      })
    )));
    if (cleanup.some(({ status }) => status === "rejected")) {
      throw new Error("The load gate could not clean up every disposable session.");
    }
  }
}

async function readSession(configuration, fetchImplementation, cookie) {
  const response = await request(configuration, fetchImplementation, "/api/demo/session", {
    cookie,
    method: "GET"
  });
  if (response.status !== 200) throw new Error("A load-test session read failed.");
  const document = await boundedJson(response);
  if (document?.session?.status !== "active") {
    throw new Error("A load-test session was not active.");
  }
}

async function readGuidedPage(configuration, fetchImplementation, cookie) {
  const response = await request(configuration, fetchImplementation, guidedPath, {
    accept: "text/html",
    cookie,
    method: "GET"
  });
  if (response.status !== 200) throw new Error("A load-test guided page read failed.");
  const body = await boundedText(response);
  if (!body.includes("Do these signatures point to the same fictional person?")) {
    throw new Error("A load-test guided page body was unexpected.");
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
    throw new Error("A load-test session cookie was invalid.");
  }
  return cookies[0];
}

async function boundedJson(response) {
  const contents = await boundedText(response);
  const value = JSON.parse(contents);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("A load-test response was not a JSON object.");
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
      throw new Error("A load-test response exceeded its size bound.");
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
    bypassSecret: requiredSecret(environment.VERCEL_AUTOMATION_BYPASS_SECRET)
  });
}

function exactCandidateOrigin(value) {
  if (typeof value !== "string" || value.trim() !== value) {
    throw new Error("The load-test origin is invalid.");
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
    throw new Error("The load test requires a protected generated candidate origin.");
  }
  return url.origin;
}

function requiredSecret(value) {
  if (typeof value !== "string" || value.trim() !== value || !/^[A-Za-z0-9_-]{20,256}$/.test(value)) {
    throw new Error("A load-test credential is invalid.");
  }
  return value;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  runPublicDemoLoadTest().then(() => {
    console.log("Public demo 25-session load gate passed.");
  }).catch(() => {
    console.error("Public demo 25-session load gate failed.");
    process.exitCode = 1;
  });
}
