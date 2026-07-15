#!/usr/bin/env node
// Applies pending migrations through an explicitly separate production connection.
// Run via `npm run db:migrate:production`; requires Node 22.6+ for TypeScript stripping.
import { Pool } from "pg";

import { runPendingMigrations } from "../lib/migrations.ts";
import { runProductionMigrations } from "../lib/production-migration.ts";
import { loadReleasePolicy } from "../lib/release-policy.ts";

try {
  const policy = await loadReleasePolicy({ repositoryRoot: process.cwd() });
  await runProductionMigrations({
    environment: process.env,
    expectedVersions: policy.migrations.map((migration) => migration.file.replace(/\.sql$/, "")),
    createPool: (options) => new Pool(options),
    migrate: runPendingMigrations,
    log: (message) => console.log(message)
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Production migration failed.");
  process.exitCode = 1;
}
