import { randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runPendingMigrations } from "@/lib/migrations";
import {
  LEGACY_COMPATIBILITY_EXPECTATIONS,
  loadReleasePolicy,
  type LegacyCompatibilityExpectation,
  type ReleasePolicy
} from "@/lib/release-policy";
import { validateReleaseUpgradeDatabase } from "@/lib/test-database-contract";

const repositoryRoot = process.cwd();
const releaseDatabaseUrl = process.env.TEST_RELEASE_UPGRADE_DATABASE_URL;
const probePath = path.join(repositoryRoot, "scripts", "legacy-release-probe.ts");

type ProbeResult = Record<string, unknown> & {
  packageVersion: string;
};

function derivedDatabaseUrl(controlUrl: string, databaseName: string): string {
  const url = new URL(controlUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function createScratchDatabase(
  controlPool: Pool,
  controlUrl: string,
  trackedDatabases: Set<string>
): Promise<{ name: string; url: string; pool: Pool }> {
  const name = `kr_compat_${process.pid}_${randomBytes(5).toString("hex")}`;
  if (!/^kr_compat_[a-z0-9_]+$/.test(name)) {
    throw new Error("Generated an invalid compatibility scratch database name.");
  }
  await controlPool.query(`CREATE DATABASE "${name}"`);
  trackedDatabases.add(name);
  const url = derivedDatabaseUrl(controlUrl, name);
  return { name, url, pool: new Pool({ connectionString: url, max: 4 }) };
}

async function dropScratchDatabase(controlPool: Pool, name: string, trackedDatabases: Set<string>): Promise<void> {
  if (!trackedDatabases.has(name) || !/^kr_compat_[a-z0-9_]+$/.test(name)) {
    throw new Error(`Refusing to drop untracked compatibility database: ${name}.`);
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const connections = await controlPool.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = $1",
      [name]
    );
    if (connections.rows[0].count === 0) {
      await controlPool.query(`DROP DATABASE IF EXISTS "${name}"`);
      trackedDatabases.delete(name);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Compatibility scratch database ${name} still has active connections after cleanup.`);
}

function runLegacyProbe(
  mode: "auth" | "seed" | "rewrite",
  legacyRoot: string,
  scratchDatabaseUrl: string,
  archiveId: string
): ProbeResult {
  const environment = { ...process.env };
  delete environment.DATABASE_URL;
  delete environment.TEST_DATABASE_URL;
  delete environment.TEST_RELEASE_UPGRADE_DATABASE_URL;
  environment.DATABASE_AUTO_MIGRATE = "false";
  environment.NODE_ENV = "test";
  environment.NO_PROXY = "*";

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", probePath, mode, legacyRoot, scratchDatabaseUrl, archiveId],
    {
      cwd: legacyRoot,
      encoding: "utf8",
      env: environment,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 30_000
    }
  );
  if (result.error) {
    throw new Error("Archived legacy compatibility probe could not complete.", { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(`Archived legacy compatibility probe failed: ${result.stderr.trim() || "unknown failure"}`);
  }
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  if (lines.length !== 1) {
    throw new Error("Archived legacy compatibility probe must emit exactly one JSON result.");
  }
  return JSON.parse(lines[0]) as ProbeResult;
}

function policyEvidence(policy: ReleasePolicy, id: LegacyCompatibilityExpectation["id"]): LegacyCompatibilityExpectation {
  const evidence = policy.legacyCompatibility.requiredEvidence.find((item) => item.id === id);
  if (!evidence) {
    throw new Error(`Release policy is missing required legacy compatibility evidence ${id}.`);
  }
  return evidence;
}

async function insertPilotArchive(pool: Pool, archiveId: string): Promise<void> {
  await pool.query(
    `INSERT INTO archives (id, name, slug, dataset_mode)
     VALUES ($1, 'Hermetic compatibility archive', $2, 'pilot')`,
    [archiveId, `${archiveId}-slug`]
  );
}

describe.skipIf(!releaseDatabaseUrl)("v0.17.4/current-schema forward-only compatibility", () => {
  const trackedDatabases = new Set<string>();
  let controlPool: Pool;
  let scratchPool: Pool;
  let scratchDatabaseName: string;
  let scratchDatabaseUrl: string;
  let temporaryRoot: string;
  let legacyRoot: string;
  let policy: ReleasePolicy;
  let scratchInitialized = false;
  let controlInitialized = false;

  beforeAll(async () => {
    validateReleaseUpgradeDatabase({
      releaseDatabaseUrl,
      testDatabaseUrl: process.env.TEST_DATABASE_URL,
      databaseUrl: process.env.DATABASE_URL
    });
    policy = await loadReleasePolicy({ repositoryRoot });
    expect(policy.rollbackPolicy).toBe("forward-only");
    expect(policy.firstCompatibleRollbackAnchor).toBeNull();
    expect(policy.legacyCompatibility).toMatchObject({
      tag: policy.baseline.tag,
      commit: policy.baseline.commit,
      expectedResult: "incompatible-forward-only",
      requiredEvidence: LEGACY_COMPATIBILITY_EXPECTATIONS
    });

    const taggedCommit = execFileSync("git", ["rev-parse", `${policy.baseline.tag}^{commit}`], {
      cwd: repositoryRoot,
      encoding: "utf8"
    }).trim();
    expect(taggedCommit).toBe(policy.baseline.commit);

    temporaryRoot = await mkdtemp(path.join(tmpdir(), "kinresolve-v0174-compat-"));
    legacyRoot = path.join(temporaryRoot, "release");
    await mkdir(legacyRoot);
    const archivePath = path.join(temporaryRoot, "release.tar");
    execFileSync("git", ["archive", "--format=tar", `--output=${archivePath}`, policy.baseline.tag], {
      cwd: repositoryRoot
    });
    execFileSync("tar", ["-xf", archivePath, "-C", legacyRoot]);
    await symlink(path.join(repositoryRoot, "node_modules"), path.join(legacyRoot, "node_modules"), "dir");
    const archivedPackage = JSON.parse(await readFile(path.join(legacyRoot, "package.json"), "utf8")) as {
      version?: unknown;
    };
    expect(archivedPackage.version).toBe("0.17.4");

    controlPool = new Pool({ connectionString: releaseDatabaseUrl, max: 2 });
    controlInitialized = true;
  });

  beforeEach(async () => {
    scratchInitialized = false;
    const scratch = await createScratchDatabase(controlPool, releaseDatabaseUrl!, trackedDatabases);
    scratchDatabaseName = scratch.name;
    scratchDatabaseUrl = scratch.url;
    scratchPool = scratch.pool;
    scratchInitialized = true;

    const migrationResult = await runPendingMigrations(scratchPool);
    expect(migrationResult.applied).toEqual(
      policy.migrations.map((migration) => migration.file.replace(/\.sql$/, ""))
    );
    const ledger = await scratchPool.query<{ version: string }>(
      "SELECT version FROM schema_migrations ORDER BY version"
    );
    expect(ledger.rows.map((row) => row.version)).toEqual(
      policy.migrations.map((migration) => migration.file.replace(/\.sql$/, ""))
    );
  });

  afterEach(async () => {
    if (!scratchInitialized) return;
    await scratchPool.end();
    await dropScratchDatabase(controlPool, scratchDatabaseName, trackedDatabases);
    scratchInitialized = false;
  });

  afterAll(async () => {
    if (controlInitialized) {
      for (const name of [...trackedDatabases]) {
        await dropScratchDatabase(controlPool, name, trackedDatabases);
      }
      await controlPool.end();
    }
    if (temporaryRoot) {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("proves the tagged shared session remains valid without a current account or membership", async () => {
    expect(policyEvidence(policy, "auth-account-boundary")).toEqual({
      id: "auth-account-boundary",
      migrationFiles: ["003_auth_accounts.sql"],
      expectedObservation: "shared-session-valid-without-current-user-or-membership"
    });
    const accountState = await scratchPool.query<{ users: number; sessions: number; memberships: number }>(
      `SELECT
        (SELECT count(*)::integer FROM "user") AS users,
        (SELECT count(*)::integer FROM "session") AS sessions,
        (SELECT count(*)::integer FROM memberships) AS memberships`
    );
    expect(accountState.rows).toEqual([{ users: 0, sessions: 0, memberships: 0 }]);

    const result = runLegacyProbe("auth", legacyRoot, scratchDatabaseUrl, "compat-auth");
    expect(result).toMatchObject({
      probe: "auth-account-boundary",
      packageVersion: "0.17.4",
      accepted: true,
      sharedPasswordAccepted: true,
      cookieName: "kinsleuth_session",
      expectedCookieName: "kinsleuth_session",
      subjectlessIssuedAtPayload: true
    });
  });

  it("proves a tagged workspace rewrite erases current guided-research state", async () => {
    expect(policyEvidence(policy, "guided-state-preservation")).toEqual({
      id: "guided-state-preservation",
      migrationFiles: ["005_guided_research_loop.sql"],
      expectedObservation: "legacy-rewrite-resets-current-guided-fields"
    });
    const archiveId = "compat-guided";
    await insertPilotArchive(scratchPool, archiveId);
    await scratchPool.query(
      `INSERT INTO research_cases (archive_id, id, title, question)
       VALUES ($1, 'case-current', 'Current case', 'What must the old writer preserve?')`,
      [archiveId]
    );
    await scratchPool.query(
      `INSERT INTO hypotheses (archive_id, id, case_id, statement, status, decisions, updated_at)
       VALUES ($1, 'hyp-current', 'case-current', 'Current hypothesis', 'supported',
         '[{"decisionId":"decision-current","reason":"current evidence"}]'::jsonb,
         '2026-07-15T00:00:00Z')`,
      [archiveId]
    );
    await scratchPool.query(
      `INSERT INTO tasks (
         archive_id, id, case_id, title, status, origin, priority, guide_key,
         work_fingerprint, guidance, target_hypothesis_id, context_refs, outcomes, updated_at
       ) VALUES (
         $1, 'task-current', 'case-current', 'Current guided task', 'doing', 'guide', 'high',
         'guide-current', 'current fingerprint', 'Preserve this guidance', 'hyp-current',
         '[{"kind":"hypothesis","id":"hyp-current"}]'::jsonb,
         '[{"summary":"current outcome"}]'::jsonb,
         '2026-07-15T00:00:00Z'
       )`,
      [archiveId]
    );

    const result = runLegacyProbe("rewrite", legacyRoot, scratchDatabaseUrl, archiveId);
    expect(result).toMatchObject({ probe: "rewrite", packageVersion: "0.17.4", completed: true, failure: null });

    const hypothesis = await scratchPool.query(
      "SELECT decisions, updated_at FROM hypotheses WHERE archive_id = $1 AND id = 'hyp-current'",
      [archiveId]
    );
    expect(hypothesis.rows).toEqual([{ decisions: [], updated_at: null }]);
    const task = await scratchPool.query(
      `SELECT origin, priority, guide_key, work_fingerprint, guidance, target_hypothesis_id,
         context_refs, outcomes, completed_at, updated_at
       FROM tasks WHERE archive_id = $1 AND id = 'task-current'`,
      [archiveId]
    );
    expect(task.rows).toEqual([{
      origin: "manual",
      priority: "normal",
      guide_key: null,
      work_fingerprint: "",
      guidance: "",
      target_hypothesis_id: null,
      context_refs: [],
      outcomes: [],
      completed_at: null,
      updated_at: null
    }]);
  });

  it("proves a tagged workspace rewrite cannot safely delete a referenced current backup", async () => {
    expect(policyEvidence(policy, "integration-reference-preservation")).toEqual({
      id: "integration-reference-preservation",
      migrationFiles: ["006_integration_sources.sql"],
      expectedObservation: "legacy-rewrite-rejected-by-current-reference"
    });
    const archiveId = "compat-integration";
    await insertPilotArchive(scratchPool, archiveId);
    await scratchPool.query(
      `INSERT INTO workspace_backups (archive_id, id, reason, storage_key)
       VALUES ($1, 'backup-current', 'Current integration backup', 'backups/current.json')`,
      [archiveId]
    );
    await scratchPool.query(
      `INSERT INTO integration_connections (
         archive_id, id, provider, authority, display_name, capabilities
       ) VALUES ($1, 'connection-current', 'gedcom', 'local-file', 'Current source',
         '{"read":true,"writeback":false}'::jsonb)`,
      [archiveId]
    );
    await scratchPool.query(
      `INSERT INTO sync_runs (archive_id, id, connection_id, status, backup_id)
       VALUES ($1, 'run-current', 'connection-current', 'applied', 'backup-current')`,
      [archiveId]
    );

    const result = runLegacyProbe("rewrite", legacyRoot, scratchDatabaseUrl, archiveId);
    expect(result).toMatchObject({
      probe: "rewrite",
      packageVersion: "0.17.4",
      completed: false,
      failure: {
        code: "23503",
        constraint: "sync_runs_backup_fkey",
        table: "sync_runs"
      }
    });
    await expect(
      scratchPool.query(
        `SELECT backup.id AS backup_id, run.id AS run_id
         FROM workspace_backups backup
         JOIN sync_runs run ON run.archive_id = backup.archive_id AND run.backup_id = backup.id
         WHERE backup.archive_id = $1`,
        [archiveId]
      )
    ).resolves.toMatchObject({ rows: [{ backup_id: "backup-current", run_id: "run-current" }] });
  });

  it("proves a tagged first read seeds synthetic demo rows into a current pilot archive", async () => {
    expect(policyEvidence(policy, "pilot-seed-isolation")).toEqual({
      id: "pilot-seed-isolation",
      migrationFiles: ["012_archive_dataset_mode.sql"],
      expectedObservation: "legacy-read-seeds-demo-fixtures-into-pilot"
    });
    const archiveId = "compat-pilot-seed";
    const result = runLegacyProbe("seed", legacyRoot, scratchDatabaseUrl, archiveId);
    expect(result).toMatchObject({
      probe: "pilot-seed-isolation",
      packageVersion: "0.17.4",
      sourceTitles: expect.any(Array)
    });
    expect(result.peopleCount).toEqual(expect.any(Number));
    expect(result.peopleCount as number).toBeGreaterThan(0);
    expect(result.sourceTitles as unknown[]).not.toHaveLength(0);

    const archive = await scratchPool.query<{
      dataset_mode: string;
      demo_fixture_version: number | null;
      people_count: number;
      seeded_source_count: number;
    }>(
      `SELECT archive.dataset_mode, archive.demo_fixture_version,
         (SELECT count(*)::integer FROM people WHERE archive_id = archive.id) AS people_count,
         (SELECT count(*)::integer FROM sources
          WHERE archive_id = archive.id) AS seeded_source_count
       FROM archives archive WHERE archive.id = $1`,
      [archiveId]
    );
    expect(archive.rows).toEqual([{
      dataset_mode: "pilot",
      demo_fixture_version: null,
      people_count: result.peopleCount,
      seeded_source_count: (result.sourceTitles as unknown[]).length
    }]);
  });
});
