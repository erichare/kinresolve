#!/usr/bin/env node
// Applies pending versioned migrations from db/migrations to DATABASE_URL.
// Run via `npm run db:migrate`; requires Node 22.6+ for TypeScript stripping.
import { Pool } from "pg";

const [{ runPendingMigrations }, { getDatabaseConnectionString }, { describeMigrationFailure }] = await Promise.all([
  import(new URL("../lib/migrations.ts", import.meta.url).href),
  import(new URL("../lib/connection-string.ts", import.meta.url).href),
  import(new URL("../lib/migration-failure.ts", import.meta.url).href)
]);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required. Set it before running db:migrate.");
  process.exit(1);
}

const pool = new Pool({ connectionString: getDatabaseConnectionString(databaseUrl), max: 2 });

try {
  const result = await runPendingMigrations(pool);
  for (const version of result.applied) {
    console.log(`applied ${version}`);
  }
  console.log(
    result.applied.length > 0
      ? `Applied ${result.applied.length} migration(s); ${result.alreadyApplied.length} already recorded.`
      : `No pending migrations; ${result.alreadyApplied.length} already recorded.`
  );
} catch (error) {
  console.error(describeMigrationFailure(error, databaseUrl));
  process.exitCode = 1;
} finally {
  await pool.end();
}
