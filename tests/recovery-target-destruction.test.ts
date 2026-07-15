import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("disposable recovery database destruction", () => {
  it("rejects equal source and target projects before network access without leaking credentials", () => {
    const secretMarker = "never-print-recovery-provider-token";
    const projectRef = "a".repeat(20);
    const result = spawnSync(process.execPath, [
      "--no-warnings",
      "--experimental-strip-types",
      "scripts/destroy-recovery-database-target.mjs",
      path.join(process.cwd(), ".test-recovery-destruction-proof.json")
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        SUPABASE_ACCESS_TOKEN: secretMarker,
        RECOVERY_TARGET_SUPABASE_ACCESS_TOKEN: `${secretMarker}-target`,
        SUPABASE_PROJECT_REF: projectRef,
        RECOVERY_TARGET_SUPABASE_PROJECT_REF: projectRef
      }
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/must not be the production source project/i);
    expect(`${result.stdout}${result.stderr}`).not.toContain(secretMarker);
  });

  it("rejects reuse of the source-read token for target destruction before provider access", () => {
    const secretMarker = "never-reuse-source-project-token";
    const result = spawnSync(process.execPath, [
      "--no-warnings",
      "--experimental-strip-types",
      "scripts/destroy-recovery-database-target.mjs",
      path.join(process.cwd(), ".test-recovery-destruction-proof.json")
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        SUPABASE_ACCESS_TOKEN: secretMarker,
        RECOVERY_TARGET_SUPABASE_ACCESS_TOKEN: secretMarker,
        SUPABASE_PROJECT_REF: "a".repeat(20),
        RECOVERY_TARGET_SUPABASE_PROJECT_REF: "b".repeat(20)
      }
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/credentials must be distinct/i);
    expect(`${result.stdout}${result.stderr}`).not.toContain(secretMarker);
  });
});
