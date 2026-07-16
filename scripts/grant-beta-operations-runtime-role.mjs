#!/usr/bin/env node
import { chmod, writeFile } from "node:fs/promises";

import { loadReleaseContractFiles } from "../lib/release-contract.ts";
import { grantAndAttestBetaOperationsRuntimeRole } from "../lib/runtime-database-grants.ts";

class PublicDemoRuntimeCredentialError extends Error {
  constructor() {
    super("The protected public demo runtime credential is missing.");
    this.name = "PublicDemoRuntimeCredentialError";
  }
}

try {
  const [outputPath, target, ...unexpected] = process.argv.slice(2);
  if (
    !outputPath
    || unexpected.length > 0
    || (target !== undefined && !["--public-demo", "--recovery-target"].includes(target))
  ) throw new Error("Invalid runtime grant arguments.");

  const input = target === "--recovery-target"
    ? recoveryTargetInput()
    : target === "--public-demo"
      ? await publicDemoInput()
      : await vercelProductionInput();

  const attestation = await grantAndAttestBetaOperationsRuntimeRole(input);
  await writeFile(outputPath, `${JSON.stringify(attestation, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await chmod(outputPath, 0o600);
  console.log("Beta operations runtime grants applied and re-attested.");
} catch (error) {
  // PostgreSQL and dotenv errors can contain credentials. The detailed library
  // failures remain testable. The only public detail is a fixed code for the
  // expected control-plane configuration error; driver details stay hidden.
  const suffix = error instanceof PublicDemoRuntimeCredentialError
    ? " (missing-protected-runtime-credential)"
    : "";
  console.error(`Beta operations runtime grant attestation failed${suffix}.`);
  process.exitCode = 1;
}

async function vercelProductionInput() {
  // Treat Vercel's pulled dotenv strictly as data. Shell-sourcing it would let
  // production secret bytes alter the release runner command stream.
  const files = await loadReleaseContractFiles({ repositoryRoot: process.cwd() });
  return {
    runtimeDatabaseUrl: requiredValue(files.productionEnvironment.DATABASE_URL),
    migrationDatabaseUrl: requiredValue(process.env.MIGRATION_DATABASE_URL),
    expectedDatabaseIdentity: requiredValue(
      files.productionEnvironment.KINRESOLVE_DATABASE_IDENTITY
    ),
    expectedArchiveId: requiredValue(files.productionEnvironment.KINSLEUTH_ARCHIVE_ID)
  };
}

async function publicDemoInput() {
  // Vercel Sensitive values are intentionally absent from pulled dotenv files.
  // The public demo therefore receives the same bounded runtime URL through a
  // step-scoped protected GitHub secret while retaining readable cell identity
  // and archive bindings from the already validated Vercel environment.
  const files = await loadReleaseContractFiles({ repositoryRoot: process.cwd() });
  if (
    files.productionEnvironment.KINRESOLVE_PUBLIC_DEMO_ENABLED !== "true"
    || files.productionEnvironment.KINRESOLVE_DATASET_MODE !== "demo"
  ) {
    throw new Error("The protected runtime credential requires the public demo profile.");
  }
  return {
    runtimeDatabaseUrl: requiredPublicDemoRuntimeCredential(
      process.env.PUBLIC_DEMO_RUNTIME_DATABASE_URL
    ),
    migrationDatabaseUrl: requiredValue(process.env.MIGRATION_DATABASE_URL),
    expectedDatabaseIdentity: requiredValue(
      files.productionEnvironment.KINRESOLVE_DATABASE_IDENTITY
    ),
    expectedArchiveId: requiredValue(files.productionEnvironment.KINSLEUTH_ARCHIVE_ID)
  };
}

function recoveryTargetInput() {
  // Recovery is an explicit opt-in target. Use only target-specific protected
  // credentials; never fall back to the production runtime or migration URL.
  return {
    runtimeDatabaseUrl: requiredValue(process.env.RECOVERY_TARGET_RUNTIME_DATABASE_URL),
    migrationDatabaseUrl: requiredValue(process.env.RECOVERY_TARGET_DATABASE_URL),
    expectedDatabaseIdentity: requiredValue(process.env.EXPECTED_DATABASE_IDENTITY),
    expectedArchiveId: requiredValue(process.env.EXPECTED_ARCHIVE_ID)
  };
}

function requiredValue(value) {
  const normalized = value?.trim();
  if (!normalized) throw new Error("A required runtime grant value is missing.");
  return normalized;
}

function requiredPublicDemoRuntimeCredential(value) {
  const normalized = value?.trim();
  if (!normalized) throw new PublicDemoRuntimeCredentialError();
  return normalized;
}
