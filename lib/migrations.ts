import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";

// This module is imported by lib/db.ts at runtime AND executed directly by
// scripts/migrate.mjs under Node's type stripping, so it must only use
// erasable TypeScript syntax and must not import other project modules.

export type MigrationFile = {
  number: number;
  version: string;
  name: string;
  filePath: string;
};

export type MigrationRunResult = {
  applied: string[];
  alreadyApplied: string[];
};

const migrationFilePattern = /^(\d+)_[a-z0-9_-]+\.sql$/i;
// Transaction-scoped advisory lock (pg_advisory_xact_lock) so concurrent
// runners serialize instead of racing the same DDL. Transaction scope matters:
// over a transaction-mode pooler (Supabase port 6543) only statements inside a
// single BEGIN..COMMIT are pinned to one backend, so a session-level lock
// taken as a bare statement would silently fail to provide mutual exclusion.
const migrationAdvisoryLockKey = 727_274_637;
// Bounds how long a runner waits for the lock (or any DDL lock) before
// failing loudly instead of tying up a pooled connection indefinitely.
const migrationLockTimeout = "60s";

export function defaultMigrationsDirectory(): string {
  return path.join(process.cwd(), "db", "migrations");
}

export async function listMigrationFiles(directory: string = defaultMigrationsDirectory()): Promise<MigrationFile[]> {
  const entries = await readdir(directory);
  const files = entries
    .map((entry) => ({ entry, match: entry.match(migrationFilePattern) }))
    .filter((item): item is { entry: string; match: RegExpMatchArray } => item.match !== null)
    .map(({ entry, match }) => ({
      number: Number.parseInt(match[1], 10),
      version: entry.replace(/\.sql$/i, ""),
      name: entry,
      filePath: path.join(directory, entry)
    }))
    // Numeric ordering, not lexicographic: "5_x.sql" must sort before
    // "010_y.sql" even though it sorts after it as a string.
    .sort((left, right) => left.number - right.number || left.name.localeCompare(right.name));

  const seenNumbers = new Map<number, string>();
  for (const file of files) {
    const existing = seenNumbers.get(file.number);
    if (existing) {
      throw new Error(`Duplicate migration number ${file.number}: ${existing} and ${file.name} cannot be ordered.`);
    }
    seenNumbers.set(file.number, file.name);
  }

  return files;
}

export async function runPendingMigrations(pool: Pool, directory?: string): Promise<MigrationRunResult> {
  const files = await listMigrationFiles(directory);
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);

    const recorded = await client.query<{ version: string }>("SELECT version FROM schema_migrations");
    const alreadyApplied = new Set(recorded.rows.map((row) => row.version));
    const applied: string[] = [];

    for (const file of files) {
      if (alreadyApplied.has(file.version)) {
        continue;
      }
      if (await applyMigration(client, file)) {
        applied.push(file.version);
      } else {
        // A concurrent runner recorded this version while we waited for the lock.
        alreadyApplied.add(file.version);
      }
    }

    return {
      applied,
      alreadyApplied: files.map((file) => file.version).filter((version) => alreadyApplied.has(version))
    };
  } finally {
    client.release();
  }
}

// Creating the bookkeeping table also runs under the advisory lock: two
// concurrent CREATE TABLE IF NOT EXISTS statements can still collide on the
// underlying catalog insert without serialization.
async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(`SET LOCAL lock_timeout = '${migrationLockTimeout}'`);
    await client.query("SELECT pg_advisory_xact_lock($1)", [migrationAdvisoryLockKey]);
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

// Each migration runs in its own transaction: the advisory lock, the version
// bookkeeping row, and the migration SQL commit or roll back together, so a
// failure leaves nothing partial and nothing recorded while earlier files stay
// applied. The version row is claimed first (ON CONFLICT DO NOTHING) so a
// runner that lost the race skips the file instead of applying it twice.
// Statements that cannot run inside a transaction, such as
// CREATE INDEX CONCURRENTLY, do not belong in these files.
async function applyMigration(client: PoolClient, file: MigrationFile): Promise<boolean> {
  const sql = await readFile(file.filePath, "utf8");
  await client.query("BEGIN");
  try {
    await client.query(`SET LOCAL lock_timeout = '${migrationLockTimeout}'`);
    await client.query("SELECT pg_advisory_xact_lock($1)", [migrationAdvisoryLockKey]);
    const claimed = await client.query(
      "INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING RETURNING version",
      [file.version]
    );
    if (claimed.rowCount === 0) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(sql);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Migration ${file.name} failed and was rolled back: ${message}`, { cause: error });
  }
}
