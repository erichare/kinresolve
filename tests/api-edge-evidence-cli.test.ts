import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const releaseCommit = "b".repeat(40);

function run(script: string, arguments_: string[], environment: Record<string, string>) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", path.join(process.cwd(), "scripts", script), ...arguments_],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, ...environment }
    }
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("API edge evidence command line contract", () => {
  it("captures, validates, and live-rechecks only exact release-bound provider evidence", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "kinresolve-edge-evidence-"));
    temporaryDirectories.push(directory);
    const now = Date.now();
    const config = {
      id: "icfg_cli_1",
      version: 1,
      updatedAt: new Date(now - 60_000).toISOString(),
      firewallEnabled: true,
      rules: [{
        id: "rule_cli_api",
        name: "CLI fixture",
        active: true,
        conditionGroup: [{ conditions: [
          { type: "host", op: "eq", value: "app.kinresolve.com" },
          { type: "path", op: "pre", value: "/api/v1/" }
        ] }],
        action: { mitigate: {
          action: "rate_limit",
          rateLimit: {
            algo: "fixed_window",
            window: 60,
            limit: 5,
            keys: ["ip"],
            action: "rate_limit"
          },
          actionDuration: null,
          bypassSystem: false,
          logHeaders: []
        } },
        valid: true,
        validationErrors: null
      }],
      ips: [],
      changes: [],
      logHeaders: []
    };
    const bypasses = { result: [] };
    const probe = {
      canonicalOrigin: "https://app.kinresolve.com",
      startedAt: new Date(now - 3_000).toISOString(),
      completedAt: new Date(now - 1_000).toISOString(),
      ordinaryStatus: 404,
      rateLimitedStatus: 429,
      requestsSent: 7,
      rateLimitedResponses: 2,
      directOriginStatus: 401,
      directOriginProtectionVerified: true,
      responseLeakageObserved: false,
      providerLogsReviewed: true
    };
    const configPath = path.join(directory, "active.json");
    const bypassPath = path.join(directory, "bypasses.json");
    const probePath = path.join(directory, "probe.json");
    const evidencePath = path.join(directory, "evidence.json");
    writeFileSync(configPath, JSON.stringify(config));
    writeFileSync(bypassPath, JSON.stringify(bypasses));
    writeFileSync(probePath, JSON.stringify(probe));

    const captureEnvironment = {
      RELEASE_COMMIT: releaseCommit,
      GITHUB_REPOSITORY: "kinresolve/kinresolve",
      GITHUB_RUN_ID: "4444",
      GITHUB_RUN_ATTEMPT: "3",
      VERCEL_PROJECT_ID: "prj_cli_private",
      VERCEL_DIRECT_ORIGIN: "https://kinresolve-cli-private.vercel.app",
      API_EDGE_RULE_ID: "rule_cli_api",
      API_EDGE_EXPECTED_LIMIT: "5",
      API_EDGE_EXPECTED_WINDOW_SECONDS: "60",
      API_EDGE_EXPECTED_ACTION: "rate_limit"
    };
    const capture = run(
      "capture-api-edge-evidence.mjs",
      [configPath, bypassPath, probePath, evidencePath],
      captureEnvironment
    );
    expect(capture.status, capture.stderr).toBe(0);
    const serialized = readFileSync(evidencePath, "utf8");
    expect(serialized).not.toContain("prj_cli_private");
    expect(serialized).not.toContain("kinresolve-cli-private.vercel.app");

    const deniedAction = run(
      "capture-api-edge-evidence.mjs",
      [configPath, bypassPath, probePath, path.join(directory, "deny-evidence.json")],
      { ...captureEnvironment, API_EDGE_EXPECTED_ACTION: "deny" }
    );
    expect(deniedAction.status).not.toBe(0);
    expect(deniedAction.stderr).toContain("must be rate_limit");

    const validationEnvironment = {
      RELEASE_COMMIT: releaseCommit,
      GITHUB_REPOSITORY: "kinresolve/kinresolve",
      API_EDGE_RUN_ID: "4444",
      API_EDGE_RUN_ATTEMPT: "3"
    };
    const validation = run(
      "validate-api-edge-evidence.mjs",
      [evidencePath],
      validationEnvironment
    );
    expect(validation.status, validation.stderr).toBe(0);
    expect(validation.stdout).toContain("verified");
    expect(run(
      "validate-api-edge-evidence.mjs",
      [evidencePath],
      { ...validationEnvironment, API_EDGE_RUN_ATTEMPT: "4" }
    ).status).toBe(1);

    const live = run(
      "verify-live-api-edge-config.mjs",
      [evidencePath, configPath, bypassPath],
      {}
    );
    expect(live.status, live.stderr).toBe(0);
    const driftedPath = path.join(directory, "drifted.json");
    writeFileSync(driftedPath, JSON.stringify({ ...config, changes: ["drift"] }));
    const drifted = run(
      "verify-live-api-edge-config.mjs",
      [evidencePath, driftedPath, bypassPath],
      {}
    );
    expect(drifted.status).toBe(1);
    expect(drifted.stderr).toContain("drifted");
  });
});
