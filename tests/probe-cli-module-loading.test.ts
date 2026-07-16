import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("direct Node probe CLIs", () => {
  it.each([
    [
      "candidate protection",
      "scripts/probe-vercel-candidate-protection.mjs",
      "Generated candidate Deployment Protection proof failed.\n"
    ],
    [
      "beta legal endpoints",
      "scripts/probe-beta-legal-endpoints.mjs",
      "Live beta legal endpoint proof failed.\n"
    ]
  ])("loads the %s module graph under strip-types", (_label, script, expectedError) => {
    const result = spawnSync(process.execPath, [
      "--no-warnings",
      "--experimental-strip-types",
      script
    ], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(expectedError);
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });
});
