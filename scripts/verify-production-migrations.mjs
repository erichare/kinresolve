#!/usr/bin/env node
// Proves that production records exactly the checksum-backed release-policy migrations.
import { Pool } from "pg";

import { runProductionMigrationLedgerVerification } from "../lib/production-migration.ts";
import { loadReleasePolicy } from "../lib/release-policy.ts";

try {
  const policy = await loadReleasePolicy({ repositoryRoot: process.cwd() });
  await runProductionMigrationLedgerVerification({
    environment: process.env,
    expectedVersions: policy.migrations.map((migration) => migration.file.replace(/\.sql$/, "")),
    createPool: (options) => new Pool(options),
    log: (message) => console.log(message)
  });
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Production migration ledger verification failed."
  );
  process.exitCode = 1;
}
