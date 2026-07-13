import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { listMigrationFiles, runPendingMigrations } from "@/lib/migrations";

const databaseUrl = process.env.TEST_DATABASE_URL;

let migrationsDir: string;

beforeEach(async () => {
  migrationsDir = await mkdtemp(path.join(tmpdir(), "kinsleuth-migrations-"));
});

afterEach(async () => {
  await rm(migrationsDir, { recursive: true, force: true });
});

async function addMigration(fileName: string, sql: string): Promise<void> {
  await writeFile(path.join(migrationsDir, fileName), sql, "utf8");
}

describe("migration file discovery", () => {
  it("lists migrations in version order and ignores non-migration files", async () => {
    await addMigration("002_add_widgets.sql", "SELECT 1;");
    await addMigration("001_initial.sql", "SELECT 1;");
    await addMigration("010_later.sql", "SELECT 1;");
    await writeFile(path.join(migrationsDir, "README.md"), "not a migration", "utf8");
    await writeFile(path.join(migrationsDir, "notes.sql.bak"), "not a migration", "utf8");

    const files = await listMigrationFiles(migrationsDir);

    expect(files.map((file) => file.version)).toEqual(["001_initial", "002_add_widgets", "010_later"]);
    expect(files.map((file) => file.name)).toEqual(["001_initial.sql", "002_add_widgets.sql", "010_later.sql"]);
  });

  it("orders numerically, not lexicographically, when zero-padding is inconsistent", async () => {
    await addMigration("010_tenth.sql", "SELECT 1;");
    await addMigration("5_fifth.sql", "SELECT 1;");
    await addMigration("002_second.sql", "SELECT 1;");
    await addMigration("100_hundredth.sql", "SELECT 1;");

    const files = await listMigrationFiles(migrationsDir);

    expect(files.map((file) => file.name)).toEqual(["002_second.sql", "5_fifth.sql", "010_tenth.sql", "100_hundredth.sql"]);
    expect(files.map((file) => file.number)).toEqual([2, 5, 10, 100]);
  });

  it("rejects duplicate numeric prefixes because their order would be ambiguous", async () => {
    await addMigration("002_widgets.sql", "SELECT 1;");
    await addMigration("002_gadgets.sql", "SELECT 1;");

    await expect(listMigrationFiles(migrationsDir)).rejects.toThrow(/duplicate migration number/i);
  });

  it("rejects the same migration number written with different padding", async () => {
    await addMigration("005_widgets.sql", "SELECT 1;");
    await addMigration("5_gadgets.sql", "SELECT 1;");

    await expect(listMigrationFiles(migrationsDir)).rejects.toThrow(/duplicate migration number 5/i);
  });

  it("returns an empty list for a directory with no migrations", async () => {
    await expect(listMigrationFiles(migrationsDir)).resolves.toEqual([]);
  });
});

describe.skipIf(!databaseUrl)("migration runner", () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const scratchTables = ["ks_migration_test_a", "ks_migration_test_b"];

  async function cleanup(): Promise<void> {
    for (const table of scratchTables) {
      await pool.query(`DROP TABLE IF EXISTS ${table}`);
    }
    // The runner creates schema_migrations on first use; a fresh test database
    // does not have it yet when the first cleanup runs.
    await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    await pool.query("DELETE FROM schema_migrations WHERE version LIKE '9%_test_%'");
  }

  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it("applies pending migrations in order and records them", async () => {
    await addMigration("901_test_create_a.sql", "CREATE TABLE ks_migration_test_a (id text PRIMARY KEY);");
    await addMigration("902_test_create_b.sql", "CREATE TABLE ks_migration_test_b (id text PRIMARY KEY);");

    const result = await runPendingMigrations(pool, migrationsDir);

    expect(result.applied).toEqual(["901_test_create_a", "902_test_create_b"]);
    const recorded = await pool.query("SELECT version FROM schema_migrations WHERE version LIKE '9%_test_%' ORDER BY version");
    expect(recorded.rows.map((row) => row.version)).toEqual(["901_test_create_a", "902_test_create_b"]);
    await expect(pool.query("SELECT * FROM ks_migration_test_a")).resolves.toBeDefined();
  });

  it("skips migrations that have already been applied", async () => {
    await addMigration("901_test_create_a.sql", "CREATE TABLE ks_migration_test_a (id text PRIMARY KEY);");

    const first = await runPendingMigrations(pool, migrationsDir);
    const second = await runPendingMigrations(pool, migrationsDir);

    expect(first.applied).toEqual(["901_test_create_a"]);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toContain("901_test_create_a");
  });

  it("rolls back a failed migration completely and does not record it", async () => {
    await addMigration(
      "901_test_create_a.sql",
      "CREATE TABLE ks_migration_test_a (id text PRIMARY KEY); SELECT invalid_function_that_does_not_exist();"
    );

    await expect(runPendingMigrations(pool, migrationsDir)).rejects.toThrow(/901_test_create_a/);

    const recorded = await pool.query("SELECT version FROM schema_migrations WHERE version = '901_test_create_a'");
    expect(recorded.rows).toHaveLength(0);
    const table = await pool.query("SELECT to_regclass('ks_migration_test_a') AS name");
    expect(table.rows[0].name).toBeNull();
  });

  it("stops at the first failing migration and keeps earlier ones applied", async () => {
    await addMigration("901_test_create_a.sql", "CREATE TABLE ks_migration_test_a (id text PRIMARY KEY);");
    await addMigration("902_test_broken.sql", "SELECT invalid_function_that_does_not_exist();");

    await expect(runPendingMigrations(pool, migrationsDir)).rejects.toThrow(/902_test_broken/);

    const recorded = await pool.query("SELECT version FROM schema_migrations WHERE version LIKE '9%_test_%'");
    expect(recorded.rows.map((row) => row.version)).toEqual(["901_test_create_a"]);
  });

  it("applies a racing migration exactly once across two concurrent runners", async () => {
    await addMigration(
      "901_test_create_a.sql",
      "SELECT pg_sleep(0.5); CREATE TABLE ks_migration_test_a (id text PRIMARY KEY);"
    );
    const secondPool = new Pool({ connectionString: databaseUrl, max: 2 });

    try {
      const [first, second] = await Promise.all([
        runPendingMigrations(pool, migrationsDir),
        runPendingMigrations(secondPool, migrationsDir)
      ]);

      expect(first.applied.length + second.applied.length).toBe(1);
      expect([...first.applied, ...first.alreadyApplied]).toContain("901_test_create_a");
      expect([...second.applied, ...second.alreadyApplied]).toContain("901_test_create_a");

      const recorded = await pool.query("SELECT version FROM schema_migrations WHERE version = '901_test_create_a'");
      expect(recorded.rows).toHaveLength(1);
      await expect(pool.query("SELECT * FROM ks_migration_test_a")).resolves.toBeDefined();
    } finally {
      await secondPool.end();
    }
  });

  it("applies the real bootstrap migration idempotently through the runner", async () => {
    const result = await runPendingMigrations(pool);

    expect(result.applied.concat(result.alreadyApplied)).toContain("001_initial");
    const people = await pool.query("SELECT to_regclass('people') AS name");
    expect(people.rows[0].name).toBe("people");
  });
});
