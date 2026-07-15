import { createHash } from "node:crypto";

import {
  API_EDGE_CANONICAL_ORIGIN,
  API_EDGE_HOST,
  API_EDGE_PATH_PREFIX,
  validateApiEdgeEvidence,
  type ApiEdgeEvidence
} from "./api-edge-evidence";
import {
  validateProductionApiCanaryContext,
  validateProductionApiCanaryEvidence,
  type ProductionApiCanaryContext,
  type ProductionApiCanaryEvidence
} from "./production-api-canary";

const sha256Pattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const positiveIntegerPattern = /^[1-9][0-9]{0,19}$/;
const repositoryPattern = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const versionPattern = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;

export type ApiLaunchReleaseReceipt = Readonly<{
  schemaVersion: 1;
  release: {
    repository: string;
    commitSha: string;
    version: string;
    mode: "api-launch";
    workflow: { runId: string; runAttempt: string };
  };
  edge: {
    source: { runId: string; runAttempt: string; evidenceSha256: string };
    artifactValidated: true;
    liveConfigurationVerifiedBeforePromotion: true;
    liveConfigurationVerifiedAfterPromotion: true;
    providerProjectIdSha256: string;
    firewallConfigurationSha256: string;
    ruleConfigurationSha256: string;
    rateLimit: {
      canonicalOrigin: typeof API_EDGE_CANONICAL_ORIGIN;
      host: typeof API_EDGE_HOST;
      pathPrefix: typeof API_EDGE_PATH_PREFIX;
      algorithm: "fixed_window";
      windowSeconds: number;
      limit: number;
      keys: ["ip"];
      action: "rate_limit";
    };
    bypassesAbsent: true;
    boundedProbePassed: true;
    directOriginDenied: true;
    responseLeakageObserved: false;
    providerLogsReviewed: true;
  };
  canary: {
    evidenceSha256: string;
    evidence: ProductionApiCanaryEvidence;
  };
}>;

export type ApiLaunchReceiptExpectation = Readonly<{
  repository: string;
  releaseCommit: string;
  releaseVersion: string;
  releaseWorkflowRunId: string;
  releaseWorkflowRunAttempt: string;
  edgeWorkflowRunId: string;
  edgeWorkflowRunAttempt: string;
  edgeEvidenceSha256: string;
  canaryEvidenceSha256: string;
}>;

export function createApiLaunchReleaseReceipt(input: Readonly<{
  edgeEvidence: unknown;
  canaryEvidence: unknown;
  expectation: ApiLaunchReceiptExpectation;
  now?: Date;
}>): ApiLaunchReleaseReceipt {
  const expectation = validateExpectation(input.expectation);
  const edge = validateApiEdgeEvidence(input.edgeEvidence, {
    repository: expectation.repository,
    releaseCommit: expectation.releaseCommit,
    runId: expectation.edgeWorkflowRunId,
    runAttempt: expectation.edgeWorkflowRunAttempt
  }, input.now ?? new Date());
  const context = releaseCanaryContext(expectation);
  const canary = validateProductionApiCanaryEvidence(
    input.canaryEvidence,
    context,
    { complete: true }
  );
  const receipt: ApiLaunchReleaseReceipt = {
    schemaVersion: 1,
    release: {
      repository: expectation.repository,
      commitSha: expectation.releaseCommit,
      version: expectation.releaseVersion,
      mode: "api-launch",
      workflow: {
        runId: expectation.releaseWorkflowRunId,
        runAttempt: expectation.releaseWorkflowRunAttempt
      }
    },
    edge: sanitizedEdgeEvidence(edge, expectation.edgeEvidenceSha256),
    canary: {
      evidenceSha256: expectation.canaryEvidenceSha256,
      evidence: canary
    }
  };
  return validateApiLaunchReleaseReceipt(receipt, expectation);
}

export function validateApiLaunchReleaseReceipt(
  value: unknown,
  expectationInput: ApiLaunchReceiptExpectation
): ApiLaunchReleaseReceipt {
  const expectation = validateExpectation(expectationInput);
  const receipt = object(value, "API launch receipt");
  exactKeys(receipt, ["schemaVersion", "release", "edge", "canary"], "API launch receipt");
  if (receipt.schemaVersion !== 1) throw new Error("The API launch receipt version is invalid.");

  const release = object(receipt.release, "API launch receipt release");
  exactKeys(release, ["repository", "commitSha", "version", "mode", "workflow"], "API launch receipt release");
  const workflow = object(release.workflow, "API launch receipt workflow");
  exactKeys(workflow, ["runId", "runAttempt"], "API launch receipt workflow");
  if (
    release.repository !== expectation.repository
    || release.commitSha !== expectation.releaseCommit
    || release.version !== expectation.releaseVersion
    || release.mode !== "api-launch"
    || workflow.runId !== expectation.releaseWorkflowRunId
    || workflow.runAttempt !== expectation.releaseWorkflowRunAttempt
  ) {
    throw new Error("The API launch receipt release binding is invalid.");
  }

  const edge = object(receipt.edge, "API launch receipt edge evidence");
  exactKeys(edge, [
    "source", "artifactValidated", "liveConfigurationVerifiedBeforePromotion",
    "liveConfigurationVerifiedAfterPromotion", "providerProjectIdSha256",
    "firewallConfigurationSha256", "ruleConfigurationSha256", "rateLimit",
    "bypassesAbsent", "boundedProbePassed", "directOriginDenied",
    "responseLeakageObserved", "providerLogsReviewed"
  ], "API launch receipt edge evidence");
  const source = object(edge.source, "API launch receipt edge source");
  exactKeys(source, ["runId", "runAttempt", "evidenceSha256"], "API launch receipt edge source");
  if (
    source.runId !== expectation.edgeWorkflowRunId
    || source.runAttempt !== expectation.edgeWorkflowRunAttempt
    || source.evidenceSha256 !== expectation.edgeEvidenceSha256
  ) {
    throw new Error("The API launch receipt edge source is invalid.");
  }
  for (const digest of [
    edge.providerProjectIdSha256,
    edge.firewallConfigurationSha256,
    edge.ruleConfigurationSha256
  ]) {
    if (typeof digest !== "string" || !sha256Pattern.test(digest)) {
      throw new Error("The API launch receipt edge digest is invalid.");
    }
  }
  for (const key of [
    "artifactValidated", "liveConfigurationVerifiedBeforePromotion",
    "liveConfigurationVerifiedAfterPromotion", "bypassesAbsent", "boundedProbePassed",
    "directOriginDenied", "providerLogsReviewed"
  ]) {
    if (edge[key] !== true) throw new Error("The API launch receipt edge proof is incomplete.");
  }
  if (edge.responseLeakageObserved !== false) {
    throw new Error("The API launch receipt records response leakage.");
  }
  validateRateLimit(edge.rateLimit);

  const canary = object(receipt.canary, "API launch receipt canary");
  exactKeys(canary, ["evidenceSha256", "evidence"], "API launch receipt canary");
  if (canary.evidenceSha256 !== expectation.canaryEvidenceSha256) {
    throw new Error("The API launch receipt canary digest is invalid.");
  }
  validateProductionApiCanaryEvidence(canary.evidence, releaseCanaryContext(expectation), {
    complete: true
  });
  return receipt as unknown as ApiLaunchReleaseReceipt;
}

export function apiLaunchReleaseReceiptSha256(value: ApiLaunchReleaseReceipt): string {
  return createHash("sha256").update(`${JSON.stringify(value)}\n`, "utf8").digest("hex");
}

export function apiLaunchReleaseAssetName(receipt: ApiLaunchReleaseReceipt): string {
  return `kinresolve-api-launch-receipt-run-${receipt.release.workflow.runId}-attempt-${receipt.release.workflow.runAttempt}.json`;
}

export function apiLaunchReleaseNotesMarker(
  receipt: ApiLaunchReleaseReceipt,
  receiptSha256: string
): string {
  if (!sha256Pattern.test(receiptSha256)) {
    throw new Error("The API launch receipt digest is invalid.");
  }
  const identity = `run=${receipt.release.workflow.runId} attempt=${receipt.release.workflow.runAttempt}`;
  return [
    `<!-- kinresolve-api-launch-receipt:v1 ${identity} -->`,
    "## Developer API launch evidence",
    `- Release workflow: run \`${receipt.release.workflow.runId}\`, attempt \`${receipt.release.workflow.runAttempt}\``,
    `- API edge workflow: run \`${receipt.edge.source.runId}\`, attempt \`${receipt.edge.source.runAttempt}\``,
    `- API edge evidence SHA-256: \`${receipt.edge.source.evidenceSha256}\``,
    `- Ephemeral API canary evidence SHA-256: \`${receipt.canary.evidenceSha256}\``,
    `- Combined API launch receipt SHA-256: \`${receiptSha256}\``,
    `<!-- /kinresolve-api-launch-receipt:v1 ${identity} -->`
  ].join("\n");
}

export function apiLaunchReleaseNotesMarkerState(
  releaseNotes: string,
  expectedMarker: string
): "absent" | "present" {
  const expected = parseApiLaunchReleaseNotesMarkers(expectedMarker);
  if (expected.length !== 1 || expected[0]!.block !== expectedMarker.trimEnd()) {
    throw new Error("The expected API launch release marker is invalid.");
  }
  const markers = parseApiLaunchReleaseNotesMarkers(releaseNotes);
  const matching = markers.filter((marker) => marker.identity === expected[0]!.identity);
  if (matching.length === 0) return "absent";
  if (matching.length !== 1 || matching[0]!.block !== expected[0]!.block) {
    throw new Error("The API launch release marker does not match the current attempt.");
  }
  return "present";
}

type ParsedNotesMarker = Readonly<{
  identity: string;
  block: string;
}>;

function parseApiLaunchReleaseNotesMarkers(value: string): ParsedNotesMarker[] {
  const sentinel = "kinresolve-api-launch-receipt:v1";
  const sentinelCount = value.split(sentinel).length - 1;
  const tokenPattern = /<!-- (\/?kinresolve-api-launch-receipt:v1) run=([1-9][0-9]*) attempt=([1-9][0-9]*) -->/g;
  const tokens = [...value.matchAll(tokenPattern)];
  if (tokens.length !== sentinelCount || tokens.length % 2 !== 0) {
    throw new Error("The API launch release notes contain a malformed receipt marker.");
  }

  const markers: ParsedNotesMarker[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < tokens.length; index += 2) {
    const opening = tokens[index]!;
    const closing = tokens[index + 1]!;
    const runId = opening[2]!;
    const runAttempt = opening[3]!;
    const identity = `${runId}:${runAttempt}`;
    if (
      opening[1] !== sentinel
      || closing[1] !== `/${sentinel}`
      || closing[2] !== runId
      || closing[3] !== runAttempt
      || seen.has(identity)
    ) {
      throw new Error("The API launch release notes contain an invalid receipt marker sequence.");
    }
    const start = opening.index!;
    const end = closing.index! + closing[0].length;
    const block = value.slice(start, end);
    validateNotesMarkerBlock(block, runId, runAttempt);
    markers.push({ identity, block });
    seen.add(identity);
  }
  return markers;
}

function validateNotesMarkerBlock(block: string, runId: string, runAttempt: string): void {
  const lines = block.split("\n");
  const digestLine = /^- (?:API edge evidence|Ephemeral API canary evidence|Combined API launch receipt) SHA-256: `([a-f0-9]{64})`$/;
  if (
    lines.length !== 8
    || lines[0] !== `<!-- kinresolve-api-launch-receipt:v1 run=${runId} attempt=${runAttempt} -->`
    || lines[1] !== "## Developer API launch evidence"
    || lines[2] !== `- Release workflow: run \`${runId}\`, attempt \`${runAttempt}\``
    || !/^- API edge workflow: run `[1-9][0-9]*`, attempt `[1-9][0-9]*`$/.test(lines[3]!)
    || !digestLine.test(lines[4]!)
    || !digestLine.test(lines[5]!)
    || !digestLine.test(lines[6]!)
    || lines[7] !== `<!-- /kinresolve-api-launch-receipt:v1 run=${runId} attempt=${runAttempt} -->`
  ) {
    throw new Error("The API launch release notes contain an invalid receipt marker body.");
  }
}

function sanitizedEdgeEvidence(
  edge: ApiEdgeEvidence,
  evidenceSha256: string
): ApiLaunchReleaseReceipt["edge"] {
  const safeRule = {
    canonicalOrigin: edge.canonicalOrigin,
    host: edge.rule.host,
    pathPrefix: edge.rule.pathPrefix,
    algorithm: edge.rule.algorithm,
    windowSeconds: edge.rule.windowSeconds,
    limit: edge.rule.limit,
    keys: edge.rule.keys,
    action: edge.rule.action
  };
  return {
    source: {
      runId: edge.workflow.runId,
      runAttempt: edge.workflow.runAttempt,
      evidenceSha256
    },
    artifactValidated: true,
    liveConfigurationVerifiedBeforePromotion: true,
    liveConfigurationVerifiedAfterPromotion: true,
    providerProjectIdSha256: edge.providerProjectIdSha256,
    firewallConfigurationSha256: edge.firewallConfig.sha256,
    ruleConfigurationSha256: createHash("sha256")
      .update(JSON.stringify(safeRule), "utf8")
      .digest("hex"),
    rateLimit: safeRule,
    bypassesAbsent: true,
    boundedProbePassed: true,
    directOriginDenied: true,
    responseLeakageObserved: false,
    providerLogsReviewed: true
  };
}

function validateRateLimit(value: unknown): void {
  const rateLimit = object(value, "API launch receipt rate limit");
  exactKeys(rateLimit, [
    "canonicalOrigin", "host", "pathPrefix", "algorithm", "windowSeconds", "limit",
    "keys", "action"
  ], "API launch receipt rate limit");
  if (
    rateLimit.canonicalOrigin !== API_EDGE_CANONICAL_ORIGIN
    || rateLimit.host !== API_EDGE_HOST
    || rateLimit.pathPrefix !== API_EDGE_PATH_PREFIX
    || rateLimit.algorithm !== "fixed_window"
    || !Number.isSafeInteger(rateLimit.windowSeconds)
    || (rateLimit.windowSeconds as number) < 10
    || (rateLimit.windowSeconds as number) > 600
    || !Number.isSafeInteger(rateLimit.limit)
    || (rateLimit.limit as number) < 1
    || (rateLimit.limit as number) > 60
    || !Array.isArray(rateLimit.keys)
    || rateLimit.keys.length !== 1
    || rateLimit.keys[0] !== "ip"
    || rateLimit.action !== "rate_limit"
  ) {
    throw new Error("The API launch receipt rate limit is invalid.");
  }
}

function validateExpectation(value: ApiLaunchReceiptExpectation): ApiLaunchReceiptExpectation {
  if (!repositoryPattern.test(value.repository)) throw new Error("The receipt repository is invalid.");
  if (!commitPattern.test(value.releaseCommit)) throw new Error("The receipt release commit is invalid.");
  if (!versionPattern.test(value.releaseVersion)) throw new Error("The receipt release version is invalid.");
  for (const number of [
    value.releaseWorkflowRunId,
    value.releaseWorkflowRunAttempt,
    value.edgeWorkflowRunId,
    value.edgeWorkflowRunAttempt
  ]) {
    if (!positiveIntegerPattern.test(number)) throw new Error("A receipt workflow identity is invalid.");
  }
  for (const digest of [value.edgeEvidenceSha256, value.canaryEvidenceSha256]) {
    if (!sha256Pattern.test(digest)) throw new Error("A receipt evidence digest is invalid.");
  }
  return value;
}

function releaseCanaryContext(expectation: ApiLaunchReceiptExpectation): ProductionApiCanaryContext {
  return validateProductionApiCanaryContext({
    releaseCommitSha: expectation.releaseCommit,
    repository: expectation.repository,
    workflowRunId: expectation.releaseWorkflowRunId,
    workflowRunAttempt: Number(expectation.releaseWorkflowRunAttempt)
  });
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has an unexpected shape.`);
  }
}
