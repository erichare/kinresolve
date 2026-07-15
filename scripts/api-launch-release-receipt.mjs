#!/usr/bin/env node
import { createHash } from "node:crypto";
import { appendFile, chmod, open, readFile } from "node:fs/promises";

import {
  apiLaunchReleaseAssetName,
  apiLaunchReleaseNotesMarker,
  apiLaunchReleaseNotesMarkerState,
  apiLaunchReleaseReceiptSha256,
  createApiLaunchReleaseReceipt,
  validateApiLaunchReleaseReceipt
} from "../lib/api-launch-release-receipt.ts";

let command = "unknown";
try {
  const [requestedCommand, firstPath, secondPath, thirdPath, ...unexpected] = process.argv.slice(2);
  command = requestedCommand ?? "unknown";
  if (command === "assemble") {
    if (!firstPath || !secondPath || !thirdPath || unexpected.length > 0) {
      throw new Error("Invalid receipt assembly arguments.");
    }
    const edgeBytes = await boundedRead(firstPath, 1_048_576);
    const canaryBytes = await boundedRead(secondPath, 65_536);
    const expectation = receiptExpectation();
    if (sha256(edgeBytes) !== expectation.edgeEvidenceSha256) {
      throw new Error("The API edge evidence digest does not match.");
    }
    if (sha256(canaryBytes) !== expectation.canaryEvidenceSha256) {
      throw new Error("The API canary evidence digest does not match.");
    }
    const receipt = createApiLaunchReleaseReceipt({
      edgeEvidence: JSON.parse(edgeBytes),
      canaryEvidence: JSON.parse(canaryBytes),
      expectation
    });
    await writePrivateNewFile(thirdPath, `${JSON.stringify(receipt)}\n`);
    const digest = apiLaunchReleaseReceiptSha256(receipt);
    const outputPath = required("GITHUB_OUTPUT");
    await appendFile(outputPath, `receipt_sha256=${digest}\n`, "utf8");
    console.log("API launch release receipt assembled.");
  } else if (command === "validate") {
    if (!firstPath || secondPath || thirdPath || unexpected.length > 0) {
      throw new Error("Invalid receipt validation arguments.");
    }
    const bytes = await boundedRead(firstPath, 262_144);
    const expectedReceiptSha256 = required("API_LAUNCH_RECEIPT_SHA256");
    if (sha256(bytes) !== expectedReceiptSha256) {
      throw new Error("The API launch receipt digest does not match.");
    }
    validateApiLaunchReleaseReceipt(JSON.parse(bytes), receiptExpectation());
    console.log("API launch release receipt verified.");
  } else if (command === "marker") {
    if (!firstPath || !secondPath || thirdPath || unexpected.length > 0) {
      throw new Error("Invalid receipt marker arguments.");
    }
    const bytes = await boundedRead(firstPath, 262_144);
    const expectedReceiptSha256 = required("API_LAUNCH_RECEIPT_SHA256");
    if (sha256(bytes) !== expectedReceiptSha256) {
      throw new Error("The API launch receipt digest does not match.");
    }
    const receipt = validateApiLaunchReleaseReceipt(JSON.parse(bytes), receiptExpectation());
    await writePrivateNewFile(
      secondPath,
      `${apiLaunchReleaseNotesMarker(receipt, expectedReceiptSha256)}\n`
    );
    console.log("API launch release marker rendered.");
  } else if (command === "asset-name") {
    if (!firstPath || secondPath || thirdPath || unexpected.length > 0) {
      throw new Error("Invalid receipt asset-name arguments.");
    }
    const receipt = await readValidatedReceipt(firstPath);
    console.log(apiLaunchReleaseAssetName(receipt));
  } else if (command === "notes-state") {
    if (!firstPath || !secondPath || thirdPath || unexpected.length > 0) {
      throw new Error("Invalid receipt notes-state arguments.");
    }
    const releaseNotes = await boundedRead(firstPath, 1_048_576, 0);
    const marker = await boundedRead(secondPath, 16_384);
    console.log(apiLaunchReleaseNotesMarkerState(releaseNotes, marker.trimEnd()));
  } else if (command === "notes-verify") {
    if (!firstPath || !secondPath || thirdPath || unexpected.length > 0) {
      throw new Error("Invalid receipt notes-verify arguments.");
    }
    const releaseNotes = await boundedRead(firstPath, 1_048_576, 0);
    const marker = await boundedRead(secondPath, 16_384);
    if (apiLaunchReleaseNotesMarkerState(releaseNotes, marker.trimEnd()) !== "present") {
      throw new Error("The current API launch release marker is absent.");
    }
    console.log("API launch release notes verified.");
  } else {
    throw new Error("Unknown API launch receipt command.");
  }
} catch {
  console.error(`API launch release receipt ${command} failed.`);
  process.exitCode = 1;
}

function receiptExpectation() {
  return {
    repository: required("GITHUB_REPOSITORY"),
    releaseCommit: required("RELEASE_COMMIT"),
    releaseVersion: required("RELEASE_VERSION"),
    releaseWorkflowRunId: required("RELEASE_WORKFLOW_RUN_ID"),
    releaseWorkflowRunAttempt: required("RELEASE_WORKFLOW_RUN_ATTEMPT"),
    edgeWorkflowRunId: required("API_EDGE_RUN_ID"),
    edgeWorkflowRunAttempt: required("API_EDGE_RUN_ATTEMPT"),
    edgeEvidenceSha256: required("API_EDGE_EVIDENCE_SHA256"),
    canaryEvidenceSha256: required("API_CANARY_EVIDENCE_SHA256")
  };
}

async function readValidatedReceipt(filePath) {
  const bytes = await boundedRead(filePath, 262_144);
  const expectedReceiptSha256 = required("API_LAUNCH_RECEIPT_SHA256");
  if (sha256(bytes) !== expectedReceiptSha256) {
    throw new Error("The API launch receipt digest does not match.");
  }
  return validateApiLaunchReleaseReceipt(JSON.parse(bytes), receiptExpectation());
}

async function boundedRead(filePath, maximumBytes, minimumBytes = 2) {
  const value = await readFile(filePath);
  if (value.byteLength < minimumBytes || value.byteLength > maximumBytes) {
    throw new Error("An API launch receipt input has an invalid size.");
  }
  return value.toString("utf8");
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

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value || /[\0\r\n]/u.test(value)) throw new Error(`Missing ${name}.`);
  return value;
}
