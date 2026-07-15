import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("recovery database restore target binding", () => {
  it.each([
    {
      label: "direct database URL",
      databaseUrl: `postgresql://postgres:never-print-restore-secret@db.${"a".repeat(20)}.supabase.co:5432/postgres`
    },
    {
      label: "session-pooler database URL",
      databaseUrl: `postgresql://postgres.${"a".repeat(20)}:never-print-restore-secret@aws-0-us-west-1.pooler.supabase.com:5432/postgres`
    }
  ])("rejects a mismatched $label before database access or pg_restore", ({ databaseUrl }) => {
    const secretMarker = "never-print-restore-secret";
    const result = spawnSync(process.execPath, [
      "--no-warnings",
      "--experimental-strip-types",
      "scripts/recovery-database-tool.mjs",
      "restore",
      path.join(process.cwd(), ".test-recovery-database.dump")
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        RECOVERY_DATABASE_URL: databaseUrl,
        RECOVERY_TARGET_SUPABASE_PROJECT_REF: "b".repeat(20)
      }
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/does not address the declared Supabase project/i);
    expect(result.stderr).not.toMatch(/ECONN|ENOTFOUND|pg_restore/i);
    expect(`${result.stdout}${result.stderr}`).not.toContain(secretMarker);
  });

  it("suppresses client diagnostics and keeps the connection secret out of argv", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "kinresolve-recovery-client-"));
    const fakeClient = path.join(temporaryDirectory, "pg_dump");
    const proofPath = path.join(temporaryDirectory, "client-proof.json");
    const diagnosticMarker = "private-family-row-value";
    const passwordMarker = "private-recovery-password";
    try {
      await writeFile(fakeClient, `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(process.env.FAKE_CLIENT_PROOF, JSON.stringify({
  args: process.argv.slice(2),
  database: process.env.PGDATABASE,
  host: process.env.PGHOST,
  password: process.env.PGPASSWORD,
  user: process.env.PGUSER
}));
process.stdout.write(process.env.FAKE_CLIENT_DIAGNOSTIC);
process.stderr.write(process.env.FAKE_CLIENT_DIAGNOSTIC);
process.exit(23);
`, { mode: 0o700 });
      await chmod(fakeClient, 0o700);

      const result = spawnSync(process.execPath, [
        "--no-warnings",
        "--experimental-strip-types",
        "scripts/recovery-database-tool.mjs",
        "dump",
        path.join(temporaryDirectory, "database.dump")
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          FAKE_CLIENT_DIAGNOSTIC: diagnosticMarker,
          FAKE_CLIENT_PROOF: proofPath,
          PATH: `${temporaryDirectory}:${process.env.PATH ?? ""}`,
          RECOVERY_DATABASE_URL:
            `postgresql://runtime:${passwordMarker}@localhost:5432/recovery_test`
        }
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/recovery database dump command failed/i);
      expect(`${result.stdout}${result.stderr}`).not.toContain(diagnosticMarker);
      expect(`${result.stdout}${result.stderr}`).not.toContain(passwordMarker);
      const proof = JSON.parse(await readFile(proofPath, "utf8")) as Record<string, unknown>;
      expect(proof).toMatchObject({
        database: "recovery_test",
        host: "localhost",
        password: passwordMarker,
        user: "runtime"
      });
      expect(proof.args).toEqual([
        "--dbname",
        "recovery_test",
        "--no-password",
        "--format=custom",
        "--no-owner",
        "--file",
        path.join(temporaryDirectory, "database.dump")
      ]);
      expect(JSON.stringify(proof.args)).not.toContain(passwordMarker);
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
