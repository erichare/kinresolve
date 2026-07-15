import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  EXPECTED_VERCEL_DEPLOYMENT_CONFIG,
  loadVercelDeploymentConfig,
  validateVercelDeploymentConfig
} from "@/lib/vercel-deployment-config";

const repositoryRoot = process.cwd();
const validatorScript = path.join(repositoryRoot, "scripts", "validate-vercel-deployment-config.mjs");
const temporaryDirectories: string[] = [];

function fixture(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(EXPECTED_VERCEL_DEPLOYMENT_CONFIG)) as Record<string, unknown>;
}

function gitConfig(config: Record<string, unknown>): Record<string, unknown> {
  return config.git as Record<string, unknown>;
}

function crons(config: Record<string, unknown>): Array<Record<string, unknown>> {
  return config.crons as Array<Record<string, unknown>>;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Vercel deployment bypass guard", () => {
  it("accepts only the checked-in Git disablement, production region, and cron contract", async () => {
    await expect(loadVercelDeploymentConfig(repositoryRoot)).resolves.toEqual(EXPECTED_VERCEL_DEPLOYMENT_CONFIG);
    expect(validateVercelDeploymentConfig(fixture())).toEqual(EXPECTED_VERCEL_DEPLOYMENT_CONFIG);
  });

  it("rejects missing or extra top-level deployment configuration", () => {
    const missingGit = fixture();
    delete missingGit.git;
    expect(() => validateVercelDeploymentConfig(missingGit)).toThrow(/missing required field git/i);

    const extra = fixture();
    extra.buildCommand = "unsafe alternate build";
    expect(() => validateVercelDeploymentConfig(extra)).toThrow(/unexpected field buildCommand/i);

    expect(() => validateVercelDeploymentConfig([])).toThrow(/must be an object/i);
  });

  it("requires the exact schema and Next.js framework declarations", () => {
    const schema = fixture();
    schema.$schema = "https://example.test/not-vercel.json";
    expect(() => validateVercelDeploymentConfig(schema)).toThrow(/\$schema must be exactly/i);

    const framework = fixture();
    framework.framework = null;
    expect(() => validateVercelDeploymentConfig(framework)).toThrow(/framework must be exactly nextjs/i);
  });

  it("requires a literal false Git deployment switch with no adjacent bypass fields", () => {
    for (const invalid of [true, "false", 0, null]) {
      const config = fixture();
      gitConfig(config).deploymentEnabled = invalid;
      expect(() => validateVercelDeploymentConfig(config), String(invalid)).toThrow(
        /git\.deploymentEnabled must be exactly false/i
      );
    }

    const extra = fixture();
    gitConfig(extra).productionBranch = "main";
    expect(() => validateVercelDeploymentConfig(extra)).toThrow(/git contains unexpected field productionBranch/i);
  });

  it("requires exactly one production region in the reviewed order", () => {
    for (const invalid of [[], ["iad1"], ["sfo1", "iad1"], "sfo1", null]) {
      const config = fixture();
      config.regions = invalid;
      expect(() => validateVercelDeploymentConfig(config), JSON.stringify(invalid)).toThrow(
        /regions must be exactly \[sfo1\]/i
      );
    }
  });

  it("requires both exact cron definitions with no alternate order, field, path, or schedule", () => {
    const reversed = fixture();
    reversed.crons = [...crons(reversed)].reverse();
    expect(() => validateVercelDeploymentConfig(reversed)).toThrow(/cron 1 path must be exactly/i);

    const extraCron = fixture();
    crons(extraCron).push({ path: "/api/cron/extra", schedule: "* * * * *" });
    expect(() => validateVercelDeploymentConfig(extraCron)).toThrow(/exactly the reviewed production definitions/i);

    const extraField = fixture();
    crons(extraField)[0].timezone = "UTC";
    expect(() => validateVercelDeploymentConfig(extraField)).toThrow(/cron 1 contains unexpected field timezone/i);

    const pathChange = fixture();
    crons(pathChange)[0].path = "/api/cron/import-uploads";
    expect(() => validateVercelDeploymentConfig(pathChange)).toThrow(/cron 1 path must be exactly/i);

    const scheduleChange = fixture();
    crons(scheduleChange)[1].schedule = "18 7 * * *";
    expect(() => validateVercelDeploymentConfig(scheduleChange)).toThrow(/cron 2 schedule must be exactly/i);

    const malformed = fixture();
    crons(malformed)[0] = [] as unknown as Record<string, unknown>;
    expect(() => validateVercelDeploymentConfig(malformed)).toThrow(/cron 1 must be an object/i);
  });

  it("fails closed when vercel.json is missing or malformed", async () => {
    const missingRoot = await mkdtemp(path.join(tmpdir(), "kinresolve-vercel-config-missing-"));
    temporaryDirectories.push(missingRoot);
    await expect(loadVercelDeploymentConfig(missingRoot)).rejects.toThrow(/vercel\.json is missing or unreadable/i);

    const malformedRoot = await mkdtemp(path.join(tmpdir(), "kinresolve-vercel-config-malformed-"));
    temporaryDirectories.push(malformedRoot);
    await writeFile(path.join(malformedRoot, "vercel.json"), "{ not-json", "utf8");
    await expect(loadVercelDeploymentConfig(malformedRoot)).rejects.toThrow(/vercel\.json is not valid JSON/i);
  });

  it("exposes a repository-only CLI that rejects alternate-file arguments", async () => {
    const valid = spawnSync(process.execPath, ["--experimental-strip-types", validatorScript], {
      cwd: repositoryRoot,
      encoding: "utf8"
    });
    expect(valid.status, valid.stderr).toBe(0);
    expect(valid.stdout).toMatch(/Git deployments disabled.*region sfo1.*2 exact cron/i);

    const alternate = spawnSync(process.execPath, ["--experimental-strip-types", validatorScript, "other.json"], {
      cwd: repositoryRoot,
      encoding: "utf8"
    });
    expect(alternate.status).toBe(1);
    expect(alternate.stderr).toMatch(/does not accept alternate files or arguments/i);
  });
});
