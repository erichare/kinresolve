import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = path.join(process.cwd(), "scripts", "release-fence-control.mjs");

function run(args: string[], extraEnvironment: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      ...extraEnvironment,
      NODE_ENV: "test"
    }
  });
}

describe("direct release fence control CLI", () => {
  it("accepts only one reviewed operation", () => {
    for (const args of [[], ["unknown"], ["assert", "extra"]]) {
      const result = run(args);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("Usage: release-fence-control.mjs");
    }
  });

  it("fails before connection when protected database inputs are absent", () => {
    const result = run(["assert"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("RELEASE_FENCE_DATABASE_URL and EXPECTED_DATABASE_IDENTITY are required.");
  });

  it("rejects unverified remote transport without echoing the URL", () => {
    const unsafeUrl = "postgres://operator:do-not-print@example.com:5432/kinresolve";
    const result = run(["contain"], {
      RELEASE_FENCE_DATABASE_URL: unsafeUrl,
      EXPECTED_DATABASE_IDENTITY: "a".repeat(64),
      RELEASE_FENCE_ID: "fence-recovery-12345678",
      RELEASE_COMMIT: "b".repeat(40)
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("must use a verified TLS transport");
    expect(result.stderr).not.toContain(unsafeUrl);
    expect(result.stderr).not.toContain("do-not-print");
  });

  it("rejects malformed fence identity before connection without echoing it", () => {
    const result = run(["acquire"], {
      RELEASE_FENCE_DATABASE_URL: "postgres://localhost/kinresolve",
      EXPECTED_DATABASE_IDENTITY: "a".repeat(64),
      RELEASE_FENCE_ID: "bad-fence-secret",
      RELEASE_COMMIT: "not-a-commit"
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("configured release fence identity is invalid");
    expect(result.stderr).not.toContain("bad-fence-secret");
    expect(result.stderr).not.toContain("not-a-commit");
  });
});
