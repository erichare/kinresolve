import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { validateVercelProjectDomain } from "@/lib/vercel-project-domain";

const scratch: string[] = [];
const expectations = {
  expectedDomain: "demo.kinresolve.com",
  expectedProjectId: "prj_demo1234"
};

function domain(overrides: Record<string, unknown> = {}) {
  return {
    name: expectations.expectedDomain,
    apexName: "kinresolve.com",
    projectId: expectations.expectedProjectId,
    verified: true,
    redirect: null,
    redirectStatusCode: null,
    gitBranch: null,
    customEnvironmentId: null,
    updatedAt: 1_721_000_000_000,
    createdAt: 1_720_000_000_000,
    ...overrides
  };
}

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe("Vercel public demo project-domain ownership", () => {
  it("accepts only the verified unredirected domain on the exact project", () => {
    expect(validateVercelProjectDomain(domain(), expectations)).toEqual({
      domain: expectations.expectedDomain,
      projectId: expectations.expectedProjectId,
      verified: true
    });
  });

  it.each([
    ["wrong name", { name: "app.kinresolve.com" }],
    ["wrong apex", { apexName: "example.com" }],
    ["wrong project", { projectId: "prj_marketing1234" }],
    ["unverified", { verified: false }],
    ["redirect", { redirect: "kinresolve.com", redirectStatusCode: 308 }],
    ["branch", { gitBranch: "main" }],
    ["custom environment", { customEnvironmentId: "env_preview1234" }],
    ["verification challenge", { verification: [{ type: "TXT" }] }]
  ])("rejects %s", (_label, override) => {
    expect(() => validateVercelProjectDomain(domain(override), expectations)).toThrow();
  });

  it("validates a privacy-safe API response through the CLI", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "kinresolve-demo-domain-"));
    scratch.push(directory);
    const fixture = path.join(directory, "domain.json");
    await writeFile(fixture, JSON.stringify(domain()), "utf8");

    const result = spawnSync(process.execPath, [
      "--experimental-strip-types",
      "scripts/validate-vercel-project-domain.mjs",
      fixture
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        EXPECTED_VERCEL_DOMAIN: expectations.expectedDomain,
        VERCEL_PROJECT_ID: expectations.expectedProjectId
      }
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "domain=demo.kinresolve.com\nproject_id=prj_demo1234\nverified=true\n"
    );
  });
});
