#!/usr/bin/env node
import {
  acquireReleaseFence,
  assertReleaseFence,
  reacquireReleaseFence,
  releaseReleaseFence,
  ReleaseFenceError,
  validateReleaseFenceIdentity
} from "../lib/release-fence.ts";
import {
  readDatabaseIdentity,
  validateConfiguredDatabaseIdentity
} from "../lib/database-attestation.ts";
import {
  closeDatabasePools,
  getPool,
  isDatabaseTransportVerified
} from "../lib/db.ts";

const operations = new Set(["acquire", "assert", "reacquire", "release", "contain"]);
const operation = process.argv[2];
if (!operation || !operations.has(operation) || process.argv.length !== 3) {
  console.error("Usage: release-fence-control.mjs <acquire|assert|reacquire|release|contain>");
  process.exit(2);
}

const databaseUrl = process.env.RELEASE_FENCE_DATABASE_URL?.trim();
const expectedDatabaseIdentity = process.env.EXPECTED_DATABASE_IDENTITY?.trim();
if (!databaseUrl || !expectedDatabaseIdentity) {
  console.error("RELEASE_FENCE_DATABASE_URL and EXPECTED_DATABASE_IDENTITY are required.");
  process.exit(2);
}
if (!isDatabaseTransportVerified(databaseUrl)) {
  console.error("RELEASE_FENCE_DATABASE_URL must use a verified TLS transport for remote databases.");
  process.exit(2);
}

let identity;
try {
  identity = validateReleaseFenceIdentity({
    fenceId: process.env.RELEASE_FENCE_ID ?? "",
    releaseCommitSha: process.env.RELEASE_COMMIT ?? ""
  });
} catch {
  console.error("The configured release fence identity is invalid.");
  process.exit(2);
}

process.env.DATABASE_AUTO_MIGRATE = "false";
const options = { databaseUrl };

try {
  const databaseIdentity = await readDatabaseIdentity(getPool(options));
  validateConfiguredDatabaseIdentity(expectedDatabaseIdentity, databaseIdentity);

  let result;
  switch (operation) {
    case "acquire":
      result = await acquireReleaseFence(identity, options);
      break;
    case "assert":
      result = await assertReleaseFence(identity, options);
      break;
    case "reacquire":
      result = await reacquireReleaseFence(identity, options);
      break;
    case "release":
      result = await releaseReleaseFence(identity, options);
      break;
    case "contain":
      try {
        result = await reacquireReleaseFence(identity, options);
      } catch (error) {
        if (error instanceof ReleaseFenceError && error.code === "NOT_FOUND") {
          process.stdout.write(`${JSON.stringify({ found: false })}\n`);
          process.exitCode = 0;
          break;
        }
        throw error;
      }
      break;
    default:
      throw new Error("Unsupported release fence operation.");
  }

  if (result) {
    process.stdout.write(`${JSON.stringify({ found: true, ...result })}\n`);
  }
} catch (error) {
  if (error instanceof ReleaseFenceError) {
    console.error(`Release fence control failed (${error.code}).`);
  } else {
    console.error("Release fence control failed.");
  }
  process.exitCode = 1;
} finally {
  try {
    await closeDatabasePools();
  } catch {
    console.error("Release fence database cleanup failed.");
    process.exitCode = 1;
  }
}
