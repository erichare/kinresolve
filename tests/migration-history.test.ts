import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  V0174_INITIAL_SHA256,
  verifyMigrationHistory,
  type MigrationChecksumManifest
} from "@/lib/migration-history";

const scratchDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(scratchDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

async function createFixture(files: Record<string, string>, manifestFiles: Record<string, string> = files): Promise<string> {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "kinresolve-migration-history-"));
  scratchDirectories.push(repositoryRoot);
  const migrationsDirectory = path.join(repositoryRoot, "db", "migrations");
  await mkdir(migrationsDirectory, { recursive: true });

  await Promise.all(
    Object.entries(files).map(([name, contents]) => writeFile(path.join(migrationsDirectory, name), contents, "utf8"))
  );

  const manifest: MigrationChecksumManifest = {
    schemaVersion: 1,
    files: Object.fromEntries(Object.entries(manifestFiles).map(([name, contents]) => [name, sha256(contents)])),
    releaseAnchors: {}
  };
  await writeFile(path.join(migrationsDirectory, "checksums.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return repositoryRoot;
}

describe("migration checksum history", () => {
  it("accepts the checked-in migration set and the immutable v0.17.4 release anchor", async () => {
    await expect(verifyMigrationHistory({ repositoryRoot: process.cwd() })).resolves.toEqual({
      migrationFiles: ["001_initial.sql", "002_search_unaccent.sql", "003_auth_accounts.sql", "004_archive_scoped_keys.sql"],
      releaseAnchors: ["v0.17.4"]
    });
  });

  it("rejects an edited migration after its checksum is recorded", async () => {
    const repositoryRoot = await createFixture({ "001_initial.sql": "SELECT 2;\n" }, { "001_initial.sql": "SELECT 1;\n" });

    await expect(verifyMigrationHistory({ repositoryRoot })).rejects.toThrow(/checksum mismatch.*001_initial\.sql/i);
  });

  it("rejects an unmanifested SQL migration", async () => {
    const repositoryRoot = await createFixture(
      { "001_initial.sql": "SELECT 1;\n", "002_extra.sql": "SELECT 2;\n" },
      { "001_initial.sql": "SELECT 1;\n" }
    );

    await expect(verifyMigrationHistory({ repositoryRoot })).rejects.toThrow(/not recorded.*002_extra\.sql/i);
  });

  it("rejects a manifest entry whose migration file is missing", async () => {
    const repositoryRoot = await createFixture(
      { "001_initial.sql": "SELECT 1;\n" },
      { "001_initial.sql": "SELECT 1;\n", "002_missing.sql": "SELECT 2;\n" }
    );

    await expect(verifyMigrationHistory({ repositoryRoot })).rejects.toThrow(/missing.*002_missing\.sql/i);
  });

  it("does not allow the shipped v0.17.4 trust anchor to be redefined by the manifest", async () => {
    const repositoryRoot = await createFixture({ "001_initial.sql": "SELECT 1;\n" });
    const manifestPath = path.join(repositoryRoot, "db", "migrations", "checksums.json");
    const manifest: MigrationChecksumManifest = {
      schemaVersion: 1,
      files: { "001_initial.sql": sha256("SELECT 1;\n") },
      releaseAnchors: {
        "v0.17.4": { "001_initial.sql": "0".repeat(64) }
      }
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await expect(
      verifyMigrationHistory({
        repositoryRoot,
        readReleaseFile: async () => Buffer.from("release bytes that must never be trusted")
      })
    ).rejects.toThrow(new RegExp(V0174_INITIAL_SHA256, "i"));
  });
});
