#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import {
  appendFile,
  chmod,
  lstat,
  open,
  readFile,
  rename,
  rm
} from "node:fs/promises";
import path from "node:path";

import { closeDatabasePools } from "../lib/db.ts";
import {
  archiveIdEnvironmentAlias,
  describeEnvironmentAliasPair,
  readArchiveIdSetting
} from "../lib/environment-aliases.ts";
import { loadReleaseContractFiles } from "../lib/release-contract.ts";
import {
  appendProductionApiCanaryProbeEvidence,
  cleanupProductionApiCanary,
  markProductionApiCanaryCleanupConfirmed,
  markProductionApiCanaryEmergencyCleanup,
  markProductionApiCanaryImmediate401,
  markProductionApiCanaryRevoked,
  markProductionApiCanarySecretFileAttested,
  prepareProductionApiCanary,
  probeProductionApiCanary,
  probeRevokedProductionApiCanary,
  productionApiCanaryEvidenceSha256,
  revokeProductionApiCanary,
  validateProductionApiCanaryContext,
  validateProductionApiCanaryEvidence,
  validateProductionApiCanaryMetadata
} from "../lib/production-api-canary.ts";

process.env.DATABASE_AUTO_MIGRATE = "false";

let command = "unknown";
try {
  const [requestedCommand, tokenPath, metadataPath, evidencePath, ...unexpected] =
    process.argv.slice(2);
  command = requestedCommand ?? "unknown";
  if (
    !["prepare", "probe-candidate", "probe-canonical", "revoke", "prove-revoked", "finalize", "cleanup"]
      .includes(command)
    || !tokenPath
    || !metadataPath
    || !evidencePath
    || unexpected.length > 0
  ) {
    throw new Error("Invalid API canary arguments.");
  }
  requireDistinctPaths(tokenPath, metadataPath, evidencePath);

  const files = await loadReleaseContractFiles({ repositoryRoot: process.cwd() });
  const context = releaseContext();
  const apiEnvironment = files.productionEnvironment;
  if (apiEnvironment.KINRESOLVE_API_V1_ENABLED !== "true") {
    throw new Error("The production API is not enabled for this release mode.");
  }

  if (command === "prepare") {
    const prepared = await prepareProductionApiCanary({
      context,
      databaseUrl: required("MIGRATION_DATABASE_URL"),
      expectedDatabaseIdentity: requiredEnvironmentValue(
        apiEnvironment,
        "KINRESOLVE_DATABASE_IDENTITY"
      ),
      expectedArchiveId: requiredArchiveIdValue(apiEnvironment),
      expectedOwnerUserId: required("KINRESOLVE_API_CANARY_OWNER_USER_ID"),
      apiEnvironment
    });
    // Metadata is written before the bearer secret so an interrupted write can
    // still be cleaned up by token ID. Neither file is an uploaded artifact.
    await writePrivateNewFile(metadataPath, serialize(prepared.metadata));
    await writePrivateNewFile(tokenPath, `${prepared.token}\n`);
    await assertPrivateRegularFile(tokenPath, 128);
    const evidence = markProductionApiCanarySecretFileAttested(prepared.evidence);
    await writePrivateNewFile(evidencePath, serialize(evidence));
    console.log("Production API canary prepared.");
  } else if (command === "probe-candidate" || command === "probe-canonical") {
    const metadata = await readMetadata(metadataPath, context);
    const evidence = await readEvidence(evidencePath, context);
    const token = await readToken(tokenPath);
    const phase = command === "probe-candidate" ? "candidate" : "canonical";
    const probe = await probeProductionApiCanary({
      phase,
      origin: required("CANARY_ORIGIN"),
      token,
      metadata,
      context,
      expectedProductVersion: files.packageVersion,
      ...(phase === "candidate"
        ? { vercelAutomationBypassSecret: required("VERCEL_AUTOMATION_BYPASS_SECRET") }
        : {})
    });
    await replacePrivateFile(
      evidencePath,
      serialize(appendProductionApiCanaryProbeEvidence(evidence, phase, probe))
    );
    console.log(`Production API ${phase} canary passed.`);
  } else if (command === "revoke") {
    const metadata = await readMetadata(metadataPath, context);
    const evidence = await readEvidence(evidencePath, context);
    await revoke(metadata, context, apiEnvironment);
    await replacePrivateFile(evidencePath, serialize(markProductionApiCanaryRevoked(evidence)));
    console.log("Production API canary revoked.");
  } else if (command === "prove-revoked") {
    const metadata = await readMetadata(metadataPath, context);
    const evidence = await readEvidence(evidencePath, context);
    const token = await readToken(tokenPath);
    await probeRevokedProductionApiCanary({
      origin: required("CANARY_ORIGIN"),
      token,
      metadata,
      context
    });
    await replacePrivateFile(
      evidencePath,
      serialize(markProductionApiCanaryImmediate401(evidence))
    );
    console.log("Production API canary immediate revocation passed.");
  } else if (command === "finalize") {
    const metadata = await readMetadata(metadataPath, context);
    let evidence = await readEvidence(evidencePath, context);
    await revoke(metadata, context, apiEnvironment);
    evidence = markProductionApiCanaryCleanupConfirmed(evidence);
    validateProductionApiCanaryEvidence(evidence, context, { complete: true });
    await replacePrivateFile(evidencePath, serialize(evidence));
    const digest = productionApiCanaryEvidenceSha256(evidence);
    const outputPath = process.env.GITHUB_OUTPUT;
    if (!outputPath) throw new Error("GITHUB_OUTPUT is required to publish the canary digest.");
    await appendFile(outputPath, `evidence_sha256=${digest}\n`, "utf8");
    await removeRunnerFilesAfterRevocation(tokenPath, metadataPath);
    console.log("Production API canary evidence finalized.");
  } else {
    // The always() cleanup deliberately tolerates a prepare failure before the
    // metadata file exists. If metadata exists, revocation must succeed.
    const metadata = await readOptionalMetadata(metadataPath, context);
    if (metadata) {
      await revoke(metadata, context, apiEnvironment);
      const evidence = await readOptionalEvidence(evidencePath, context);
      const preserveCompleteEvidence = evidence
        ? isValidatedCompleteEvidence(evidence, context)
        : false;
      if (evidence && !preserveCompleteEvidence && !evidence.revocation?.cleanupConfirmed) {
        await replacePrivateFile(
          evidencePath,
          serialize(markProductionApiCanaryEmergencyCleanup(evidence))
        );
      }
      await removeRunnerFilesAfterRevocation(tokenPath, metadataPath);
      if (!preserveCompleteEvidence) {
        await removeRunnerFilesAfterRevocation(evidencePath);
      }
    } else {
      const result = await cleanupByContext(context, apiEnvironment);
      if (!result.found && (await fileExists(tokenPath))) {
        throw new Error("The API canary cleanup metadata is missing.");
      }
      if (result.found && !result.revoked) {
        throw new Error("The API canary cleanup did not revoke the retained token.");
      }
      let preserveCompleteEvidence = false;
      if (await fileExists(evidencePath)) {
        const evidence = await readEvidence(evidencePath, context);
        preserveCompleteEvidence = isValidatedCompleteEvidence(evidence, context);
      }
      await removeRunnerFilesAfterRevocation(tokenPath, metadataPath);
      if (!preserveCompleteEvidence) {
        await removeRunnerFilesAfterRevocation(evidencePath);
      }
    }
    console.log("Production API canary cleanup completed.");
  }
} catch {
  // The database driver, pulled environment, response body, and bearer secret
  // may contain protected details. Keep every failure deliberately generic.
  console.error(`Production API canary ${command} failed.`);
  process.exitCode = 1;
} finally {
  await closeDatabasePools().catch(() => undefined);
}

async function revoke(metadata, context, apiEnvironment) {
  return revokeProductionApiCanary({
    metadata,
    context,
    databaseUrl: required("MIGRATION_DATABASE_URL"),
    expectedDatabaseIdentity: requiredEnvironmentValue(
      apiEnvironment,
      "KINRESOLVE_DATABASE_IDENTITY"
    ),
    expectedArchiveId: requiredArchiveIdValue(apiEnvironment),
    expectedOwnerUserId: required("KINRESOLVE_API_CANARY_OWNER_USER_ID"),
    apiEnvironment,
    requestId: randomUUID()
  });
}

async function cleanupByContext(context, apiEnvironment) {
  return cleanupProductionApiCanary({
    context,
    databaseUrl: required("MIGRATION_DATABASE_URL"),
    expectedDatabaseIdentity: requiredEnvironmentValue(
      apiEnvironment,
      "KINRESOLVE_DATABASE_IDENTITY"
    ),
    expectedArchiveId: requiredArchiveIdValue(apiEnvironment),
    expectedOwnerUserId: required("KINRESOLVE_API_CANARY_OWNER_USER_ID"),
    apiEnvironment,
    requestId: randomUUID()
  });
}

function releaseContext() {
  const attempt = Number(required("GITHUB_RUN_ATTEMPT"));
  return validateProductionApiCanaryContext({
    releaseCommitSha: required("RELEASE_COMMIT"),
    repository: required("GITHUB_REPOSITORY"),
    workflowRunId: required("GITHUB_RUN_ID"),
    workflowRunAttempt: attempt
  });
}

async function readMetadata(filePath, context) {
  return validateProductionApiCanaryMetadata(await readPrivateJson(filePath), context);
}

async function readOptionalMetadata(filePath, context) {
  if (!(await fileExists(filePath))) return null;
  return readMetadata(filePath, context);
}

async function readEvidence(filePath, context) {
  return validateProductionApiCanaryEvidence(await readPrivateJson(filePath), context, {
    complete: false
  });
}

async function readOptionalEvidence(filePath, context) {
  if (!(await fileExists(filePath))) return null;
  return readEvidence(filePath, context);
}

function isValidatedCompleteEvidence(evidence, context) {
  try {
    validateProductionApiCanaryEvidence(evidence, context, { complete: true });
    return true;
  } catch {
    return false;
  }
}

async function readToken(filePath) {
  await assertPrivateRegularFile(filePath, 128);
  const contents = await readFile(filePath, "utf8");
  if (!/^kr_beta_[A-Za-z0-9_-]{43}\n$/.test(contents)) {
    throw new Error("The runner-local API canary secret is malformed.");
  }
  return contents.slice(0, -1);
}

async function readPrivateJson(filePath) {
  await assertPrivateRegularFile(filePath, 65_536);
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writePrivateNewFile(filePath, contents) {
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(filePath, 0o600);
}

async function replacePrivateFile(filePath, contents) {
  await assertPrivateRegularFile(filePath, 65_536);
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`
  );
  try {
    await writePrivateNewFile(temporaryPath, contents);
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o600);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function assertPrivateRegularFile(filePath, maximumBytes) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o600) {
    throw new Error("The runner-local API canary file is not private.");
  }
  if (info.size < 1 || info.size > maximumBytes) {
    throw new Error("The runner-local API canary file size is invalid.");
  }
}

async function fileExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

async function removeRunnerFilesAfterRevocation(...filePaths) {
  for (const filePath of filePaths) {
    await rm(filePath, { force: true });
  }
}

function requireDistinctPaths(...filePaths) {
  const resolved = filePaths.map((filePath) => path.resolve(filePath));
  if (new Set(resolved).size !== resolved.length) {
    throw new Error("API canary files must use distinct paths.");
  }
}

function serialize(value) {
  return `${JSON.stringify(value)}\n`;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value || /[\0\r\n]/u.test(value)) throw new Error(`Missing ${name}.`);
  return value;
}

function requiredEnvironmentValue(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`The pulled production environment is missing ${name}.`);
  return value;
}

function requiredArchiveIdValue(environment) {
  const value = readArchiveIdSetting(environment)?.trim();
  if (!value) {
    throw new Error(
      "The pulled production environment is missing "
      + `${describeEnvironmentAliasPair(archiveIdEnvironmentAlias)}.`
    );
  }
  return value;
}
