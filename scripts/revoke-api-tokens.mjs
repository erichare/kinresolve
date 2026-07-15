#!/usr/bin/env node
import { randomUUID } from "node:crypto";

import { revokeAllApiTokensForOperator } from "../lib/beta-api-tokens.ts";
import { closeDatabasePools } from "../lib/db.ts";

try {
  // Incident containment must never opportunistically change the schema.
  // It fails safely when migration 016 is absent instead of auto-migrating.
  process.env.DATABASE_AUTO_MIGRATE = "false";
  const [archiveId, acknowledgement, ...unexpected] = process.argv.slice(2);
  if (
    !archiveId
    || unexpected.length > 0
    || acknowledgement !== `REVOKE ALL API TOKENS FOR ${archiveId}`
  ) {
    throw new Error("Invalid API token containment arguments.");
  }
  const databaseUrl = process.env.MIGRATION_DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("MIGRATION_DATABASE_URL is required.");
  const expectedDatabaseIdentity = process.env.KINRESOLVE_DATABASE_IDENTITY?.trim();
  if (!expectedDatabaseIdentity) throw new Error("KINRESOLVE_DATABASE_IDENTITY is required.");
  const result = await revokeAllApiTokensForOperator(
    { archiveId, expectedDatabaseIdentity, requestId: randomUUID() },
    { databaseUrl }
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  // Arguments and database driver errors can contain operational details.
  // The command deliberately exposes neither those values nor token metadata.
  process.stderr.write("API token containment failed.\n");
  process.exitCode = 1;
} finally {
  await closeDatabasePools().catch(() => undefined);
}
