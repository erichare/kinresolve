import { describe, expect, it, vi } from "vitest";

import {
  runPublicDemoSpikeTest,
  safePublicDemoSpikeFailure
} from "@/scripts/public-demo-spike-test.mjs";

const environment = {
  PUBLIC_DEMO_ORIGIN: "https://kinresolve-demo-candidate.vercel.app",
  KINRESOLVE_DEMO_CANARY_SECRET: "c".repeat(43),
  KINRESOLVE_OBSERVABILITY_PROBE_SECRET: "p".repeat(43),
  VERCEL_AUTOMATION_BYPASS_SECRET: "v".repeat(43)
};

type SpikeFetchOptions = {
  landingStatus?: number;
  stormStatus?: number;
  stormBody?: Record<string, unknown>;
  diagnosticsOccupied?: number;
  cleanupFailures?: number;
};

function createSpikeFetch(options: SpikeFetchOptions = {}) {
  const counters = { landings: 0, starts: 0, ends: 0, diagnostics: 0 };
  const fetchImplementation = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    expect(headers.get("x-kinresolve-demo-canary")).toBe("c".repeat(43));
    expect(headers.get("x-vercel-protection-bypass")).toBe("v".repeat(43));

    if (url.pathname === "/" && (init?.method ?? "GET") === "GET") {
      counters.landings += 1;
      return new Response("<h1>Try Kin Resolve with a fictional family.</h1>", {
        headers: { "content-type": "text/html" },
        status: options.landingStatus ?? 200
      });
    }
    if (init?.method === "POST" && url.pathname === "/api/demo/sessions") {
      counters.starts += 1;
      if (counters.starts <= 25) {
        return jsonResponse({ workspaceUrl: "/app/cases/case-mercer-march-identity?guide=1" }, 201, {
          "set-cookie": `__Host-kinresolve-demo=${token(counters.starts)}; Path=/; Secure; HttpOnly`
        });
      }
      return jsonResponse(options.stormBody ?? {
        error: "The public demo is at capacity. Please try again shortly.",
        maximumActiveSessions: 25,
        familyUrl: "/family",
        challengeUrl: "/challenge"
      }, options.stormStatus ?? 429, { "retry-after": "300" });
    }
    if (init?.method === "POST" && url.pathname === "/api/demo/session/end") {
      counters.ends += 1;
      if (counters.ends <= (options.cleanupFailures ?? 0)) return jsonResponse({}, 503);
      return jsonResponse({ ended: true });
    }
    if (url.pathname === "/api/internal/health") {
      counters.diagnostics += 1;
      expect(headers.get("authorization")).toBe(`Bearer ${"p".repeat(43)}`);
      return jsonResponse({
        status: "ok",
        publicDemo: {
          capacity: { maximum: 25, occupied: options.diagnosticsOccupied ?? 0 }
        }
      });
    }
    return new Response(null, { status: 404 });
  });
  return { counters, fetchImplementation };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
    status
  });
}

function token(seed: number) {
  return `${String(seed).padStart(4, "0")}${"t".repeat(40)}`;
}

async function rejectedValue(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the spike gate to fail.");
}

describe("public demo launch spike gate", () => {
  it("proves 200 fast landings, fast over-capacity 429s, zero 5xx, and drained diagnostics", async () => {
    const { counters, fetchImplementation } = createSpikeFetch();

    await expect(runPublicDemoSpikeTest(environment, fetchImplementation)).resolves.toMatchObject({
      landingRequests: 200,
      landingP95Milliseconds: expect.any(Number),
      stormFast429s: 40
    });
    expect(counters.landings).toBe(200);
    expect(counters.starts).toBe(65);
    expect(counters.ends).toBe(25);
    expect(counters.diagnostics).toBe(1);
  });

  it("fails the landing stage on any non-200 landing response", async () => {
    const { fetchImplementation } = createSpikeFetch({ landingStatus: 503 });
    const failure = await rejectedValue(runPublicDemoSpikeTest(environment, fetchImplementation));
    expect(safePublicDemoSpikeFailure(failure)).toBe(
      "Public demo launch spike gate failed. stage=landing-response status=503 "
        + "attempted=200 succeeded=0 failed=200 cleanupFailed=0"
    );
  });

  it("fails the storm stage when over-capacity starts do not return the fast-429 contract", async () => {
    const wrongStatus = createSpikeFetch({ stormStatus: 503 });
    const statusFailure = await rejectedValue(
      runPublicDemoSpikeTest(environment, wrongStatus.fetchImplementation)
    );
    expect(safePublicDemoSpikeFailure(statusFailure)).toContain("stage=storm-response status=503");
    // Every created session is still ended after a storm failure.
    expect(wrongStatus.counters.ends).toBe(25);

    const wrongShape = createSpikeFetch({
      stormBody: { error: "The public demo is at capacity.", maximumActiveSessions: 30 }
    });
    const shapeFailure = await rejectedValue(
      runPublicDemoSpikeTest(environment, wrongShape.fetchImplementation)
    );
    expect(safePublicDemoSpikeFailure(shapeFailure)).toContain("stage=storm-contract status=429");
  });

  it("fails the diagnostics stage when the post-run demo is not fully drained", async () => {
    const { fetchImplementation } = createSpikeFetch({ diagnosticsOccupied: 3 });
    const failure = await rejectedValue(runPublicDemoSpikeTest(environment, fetchImplementation));
    expect(safePublicDemoSpikeFailure(failure)).toBe(
      "Public demo launch spike gate failed. stage=diagnostics-contract status=200"
    );
  });

  it("refuses canonical or credential-less origins for the disruptive spike gate", async () => {
    const canonicalFailure = await rejectedValue(runPublicDemoSpikeTest({
      ...environment,
      PUBLIC_DEMO_ORIGIN: "https://demo.kinresolve.com"
    }, vi.fn()));
    const probeFailure = await rejectedValue(runPublicDemoSpikeTest({
      ...environment,
      KINRESOLVE_OBSERVABILITY_PROBE_SECRET: ""
    }, vi.fn()));

    expect(safePublicDemoSpikeFailure(canonicalFailure)).toBe(
      "Public demo launch spike gate failed. stage=configuration"
    );
    expect(safePublicDemoSpikeFailure(probeFailure)).toBe(
      "Public demo launch spike gate failed. stage=configuration"
    );
  });
});
