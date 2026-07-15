import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  staticHoldingDeploymentMetadata,
  validateStaticHoldingCandidateDeployment
} from "@/lib/static-holding-deployment";

const scratchDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(scratchDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

const expectations = {
  expectedProjectId: "prj_kinresolve",
  expectedOrgId: "team_kinresolve",
  appBaseUrl: "https://app.kinresolve.com"
};

function holdingDeployment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "dpl_holding1234567890abcdef",
    url: "kinresolve-holding-a1b2c3-team.vercel.app",
    readyState: "READY",
    target: "production",
    projectId: expectations.expectedProjectId,
    ownerId: expectations.expectedOrgId,
    aliases: ["kinresolve-holding-a1b2c3-team.vercel.app"],
    meta: staticHoldingDeploymentMetadata,
    ...overrides
  };
}

describe("static holding deployment validation", () => {
  it("accepts only a READY unaliased production deployment with the exact static metadata", () => {
    expect(validateStaticHoldingCandidateDeployment(holdingDeployment(), expectations)).toEqual({
      id: "dpl_holding1234567890abcdef",
      url: "https://kinresolve-holding-a1b2c3-team.vercel.app",
      status: "READY"
    });
  });

  it.each([
    ["releaseRole", "product"],
    ["databaseAccess", "runtime"],
    ["rollbackPolicy", "down-migration"],
    ["packageVersion", "0.18.0"]
  ])("rejects incorrect %s metadata", (name, value) => {
    expect(() => validateStaticHoldingCandidateDeployment(holdingDeployment({
      meta: { ...staticHoldingDeploymentMetadata, [name]: value }
    }), expectations)).toThrow(new RegExp(name, "i"));
  });

  it("rejects a candidate that already owns the canonical product alias", () => {
    expect(() => validateStaticHoldingCandidateDeployment(holdingDeployment({
      aliases: ["app.kinresolve.com"]
    }), expectations)).toThrow(/canonical.*alias/i);
  });

  it("rejects unsafe or ambiguous aliases without exposing metadata", () => {
    expect(() => validateStaticHoldingCandidateDeployment(holdingDeployment({
      aliases: ["https://user:secret@app.kinresolve.com"]
    }), expectations)).toThrow(/alias/i);
    expect(() => validateStaticHoldingCandidateDeployment(holdingDeployment({
      alias: ["other.vercel.app"]
    }), expectations)).toThrow(/ambiguous.*alias/i);
  });

  it("emits only validated single-line workflow outputs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kinresolve-holding-deployment-"));
    scratchDirectories.push(root);
    const fixturePath = path.join(root, "deployment.json");
    const outputPath = path.join(root, "github-output.txt");
    await writeFile(fixturePath, JSON.stringify(holdingDeployment()), "utf8");

    const result = runCli(fixturePath, { GITHUB_OUTPUT: outputPath });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "deployment_id=dpl_holding1234567890abcdef\n"
      + "deployment_url=https://kinresolve-holding-a1b2c3-team.vercel.app\n"
      + "deployment_status=READY\n"
    );
    expect(await readFile(outputPath, "utf8")).toBe(result.stdout);
  });

  it("fails closed without leaking a marker from a rejected REST response", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kinresolve-holding-deployment-"));
    scratchDirectories.push(root);
    const fixturePath = path.join(root, "deployment.json");
    const marker = "secret-holding-marker";
    await writeFile(fixturePath, JSON.stringify(holdingDeployment({
      meta: { ...staticHoldingDeploymentMetadata, releaseRole: marker, secret: marker }
    })), "utf8");

    const result = runCli(fixturePath);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/releaseRole/i);
    expect(result.stderr).not.toContain(marker);
  });
});

function runCli(fixturePath: string, environment: Record<string, string> = {}) {
  return spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", "scripts/validate-static-holding-deployment.mjs", fixturePath],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        VERCEL_PROJECT_ID: expectations.expectedProjectId,
        VERCEL_ORG_ID: expectations.expectedOrgId,
        APP_BASE_URL: expectations.appBaseUrl,
        ...environment
      }
    }
  );
}
