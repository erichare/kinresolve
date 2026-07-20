#!/usr/bin/env node
import { chmod, writeFile } from "node:fs/promises";

import { readArchiveIdSetting } from "../lib/environment-aliases.ts";
import { loadReleaseContractFiles } from "../lib/release-contract.ts";
import { attestRuntimeDatabaseRole } from "../lib/runtime-database-role-attestation.ts";

try {
  const [outputPath, ...unexpected] = process.argv.slice(2);
  if (!outputPath || unexpected.length > 0) throw new Error("Invalid attestation output path.");

  // Vercel's pulled dotenv is parsed as data by the release-contract loader. Never
  // shell-source this file: production values may contain shell metacharacters.
  const files = await loadReleaseContractFiles({ repositoryRoot: process.cwd() });
  const runtimeDatabaseUrl = requiredValue(files.productionEnvironment.DATABASE_URL);
  const expectedDatabaseIdentity = requiredValue(
    files.productionEnvironment.KINRESOLVE_DATABASE_IDENTITY
  );
  const expectedArchiveId = requiredValue(readArchiveIdSetting(files.productionEnvironment));
  const migrationDatabaseUrl = requiredValue(process.env.MIGRATION_DATABASE_URL);

  const attestation = await attestRuntimeDatabaseRole({
    runtimeDatabaseUrl,
    migrationDatabaseUrl,
    expectedDatabaseIdentity,
    expectedArchiveId
  });
  await writeFile(outputPath, `${JSON.stringify(attestation, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await chmod(outputPath, 0o600);
  console.log("Runtime database role attestation passed.");
} catch {
  // Driver errors can contain host, role, or connection metadata. Keep the CLI
  // deliberately generic; detailed failures remain available in local unit tests.
  console.error("Runtime database role attestation failed.");
  process.exitCode = 1;
}

function requiredValue(value) {
  const normalized = value?.trim();
  if (!normalized) throw new Error("A required attestation value is missing.");
  return normalized;
}
