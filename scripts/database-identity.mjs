#!/usr/bin/env node
import { Pool } from "pg";

import { getDatabaseConnectionString, isDatabaseTransportVerified } from "../lib/connection-string.ts";
import { readDatabaseIdentity } from "../lib/database-attestation.ts";

const source = process.env.DATABASE_IDENTITY_URL?.trim();
if (!source) {
  console.error("DATABASE_IDENTITY_URL is required.");
  process.exit(1);
}
if (!isDatabaseTransportVerified(source)) {
  console.error("DATABASE_IDENTITY_URL must use a verified TLS transport for remote databases.");
  process.exit(1);
}

const pool = new Pool({ connectionString: getDatabaseConnectionString(source), max: 1 });
try {
  const identity = await readDatabaseIdentity(pool);
  console.log(identity.fingerprint);
} catch {
  console.error("Unable to attest the database identity.");
  process.exitCode = 1;
} finally {
  try {
    await pool.end();
  } catch {
    console.error("Unable to close the database identity connection.");
    process.exitCode = 1;
  }
}
