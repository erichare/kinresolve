import { createHash } from "node:crypto";

export const API_EDGE_CANONICAL_ORIGIN = "https://app.kinresolve.com";
export const API_EDGE_HOST = "app.kinresolve.com";
export const API_EDGE_PATH_PREFIX = "/api/v1/";
export const API_EDGE_EVIDENCE_TTL_MS = 24 * 60 * 60 * 1_000;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

type JsonPrimitive = null | boolean | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type UnknownRecord = Record<string, unknown>;

export type ApiEdgeRateAction = "rate_limit";

export interface ApiEdgeRuleExpectation {
  ruleId: string;
  limit?: number;
  windowSeconds?: number;
  rateAction?: ApiEdgeRateAction;
}

export interface ApiEdgeConfigurationProjection {
  firewallConfig: {
    id: string;
    version: number;
    updatedAt: string;
    sha256: string;
  };
  rule: {
    id: string;
    host: typeof API_EDGE_HOST;
    pathPrefix: typeof API_EDGE_PATH_PREFIX;
    active: true;
    valid: true;
    algorithm: "fixed_window";
    windowSeconds: number;
    limit: number;
    keys: ["ip"];
    action: ApiEdgeRateAction;
    actionDurationSeconds: number | null;
  };
  activeProjectOrDomainBypasses: 0;
}

export interface ApiEdgeProbeInput {
  canonicalOrigin: string;
  startedAt: string;
  completedAt: string;
  ordinaryStatus: number;
  rateLimitedStatus: number;
  requestsSent: number;
  rateLimitedResponses: number;
  directOriginStatus: number;
  directOriginProtectionVerified: boolean;
  responseLeakageObserved: boolean;
  providerLogsReviewed: boolean;
}

export interface ApiEdgeEvidence {
  schemaVersion: 1;
  provider: "vercel-waf";
  repository: string;
  releaseCommit: string;
  workflow: {
    runId: string;
    runAttempt: string;
  };
  capturedAt: string;
  expiresAt: string;
  canonicalOrigin: typeof API_EDGE_CANONICAL_ORIGIN;
  providerProjectIdSha256: string;
  firewallConfig: ApiEdgeConfigurationProjection["firewallConfig"];
  rule: ApiEdgeConfigurationProjection["rule"];
  bypasses: {
    activeProjectOrDomain: 0;
  };
  probe: {
    startedAt: string;
    completedAt: string;
    ordinaryStatus: 401 | 404;
    rateLimitedStatus: 429;
    requestsSent: number;
    rateLimitedResponses: number;
    directOriginStatus: 401 | 403;
    directOriginDenied: true;
    directOriginProtectionVerified: true;
    directOriginSha256: string;
    responseLeakageObserved: false;
    providerLogsReviewed: true;
  };
}

export interface ApiEdgeEvidenceExpectation {
  releaseCommit?: string;
  repository?: string;
  runId?: string;
  runAttempt?: string;
}

export class ApiEdgeEvidenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiEdgeEvidenceValidationError";
  }
}

function fail(message: string): never {
  throw new ApiEdgeEvidenceValidationError(message);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) fail(`${label} must be an object.`);
  return value;
}

function exactKeys(value: UnknownRecord, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} contains an unexpected field.`);
  }
}

function stringValue(value: unknown, label: string, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) {
    fail(`${label} is invalid.`);
  }
  return value;
}

function integerValue(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail(`${label} is invalid.`);
  }
  return value as number;
}

function timestampValue(value: unknown, label: string): { text: string; milliseconds: number } {
  const text = stringValue(value, label);
  const milliseconds = Date.parse(text);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== text) {
    fail(`${label} must be a canonical UTC timestamp.`);
  }
  return { text, milliseconds };
}

function jsonValue(value: unknown, label: string): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${label}[${index}]`));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${label}.${key}`)])
    );
  }
  return fail(`${label} is not valid JSON.`);
}

function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key]!)}`)
    .join(",")}}`;
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256Json(value: unknown): string {
  return sha256Text(stableStringify(jsonValue(value, "provider response")));
}

function assertSafeLoggedHeaders(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((header) => typeof header !== "string")) {
    fail(`${label} must be a bounded header list.`);
  }
  const normalized = value.map((header) => header.trim().toLowerCase());
  if (
    normalized.length > 1
    || new Set(normalized).size !== normalized.length
    || normalized.some((header) => header !== "x-request-id")
  ) {
    fail(`${label} may log only x-request-id.`);
  }
}

function rateAction(value: unknown, label: string): ApiEdgeRateAction {
  if (value !== "rate_limit") fail(`${label} must produce the required 429 response.`);
  return "rate_limit";
}

function actionDurationSeconds(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail("The edge rule action duration is invalid.");
  const match = /^([1-9][0-9]{0,4})(s|m|h)$/.exec(value);
  if (!match) fail("The edge rule action duration is invalid.");
  const magnitude = Number(match[1]);
  const multiplier = match[2] === "h" ? 3_600 : match[2] === "m" ? 60 : 1;
  const seconds = magnitude * multiplier;
  if (seconds > 3_600) fail("The edge rule action duration is too long for the beta control.");
  return seconds;
}

function conditionMatches(
  value: unknown,
  expected: { type: "host" | "path"; op: "eq" | "pre"; value: string }
): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => !["type", "op", "neg", "key", "value"].includes(key))) return false;
  if (value.type !== expected.type || value.op !== expected.op || value.value !== expected.value) {
    return false;
  }
  if (value.neg !== undefined && value.neg !== false) return false;
  return value.key === undefined || value.key === "";
}

function activeSystemBypassCount(value: unknown, observedAt: Date): number {
  const response = record(value, "Vercel system bypass response");
  if (!Array.isArray(response.result)) fail("Vercel system bypass result is invalid.");
  if (
    response.pagination !== undefined
    && response.pagination !== null
    && (!isRecord(response.pagination) || Object.keys(response.pagination).length > 0)
  ) {
    fail("Vercel system bypass pagination is not provably complete.");
  }
  if (response.result.length >= 100) {
    fail("Vercel system bypass pagination is not provably complete.");
  }

  let count = 0;
  for (const item of response.result) {
    const bypass = record(item, "Vercel system bypass entry");
    if (bypass.Action !== "block" && bypass.Action !== "bypass") {
      fail("A Vercel system bypass entry has an unknown action.");
    }
    const deleted = typeof bypass.DeletedAt === "string" && bypass.DeletedAt.length > 0;
    let expired = false;
    if (bypass.ExpiresAt !== undefined && bypass.ExpiresAt !== null) {
      if (typeof bypass.ExpiresAt !== "number" || !Number.isFinite(bypass.ExpiresAt)) {
        fail("A Vercel system bypass expiry is invalid.");
      }
      const expiryMilliseconds = bypass.ExpiresAt < 1_000_000_000_000
        ? bypass.ExpiresAt * 1_000
        : bypass.ExpiresAt;
      expired = expiryMilliseconds <= observedAt.getTime();
    }
    if (!deleted && !expired && bypass.Action === "bypass") count += 1;
  }
  return count;
}

export function inspectVercelApiEdgeConfiguration(input: {
  activeConfig: unknown;
  systemBypasses: unknown;
  expectedRule: ApiEdgeRuleExpectation;
  observedAt?: Date;
}): ApiEdgeConfigurationProjection {
  const observedAt = input.observedAt ?? new Date();
  if (!Number.isFinite(observedAt.getTime())) fail("The edge observation time is invalid.");
  const config = record(input.activeConfig, "Vercel active firewall configuration");
  if (config.firewallEnabled !== true) fail("The Vercel firewall is not enabled.");
  assertSafeLoggedHeaders(config.logHeaders, "The Vercel firewall header log configuration");
  if (!Array.isArray(config.rules)) fail("The Vercel active firewall rules are invalid.");
  if (!Array.isArray(config.ips)) fail("The Vercel active IP rules are invalid.");

  for (const item of config.ips) {
    const ipRule = record(item, "Vercel active IP rule");
    if (ipRule.action === "bypass") fail("An active Vercel IP bypass exists.");
  }

  const matchingRules = config.rules.filter(
    (item) => isRecord(item) && item.id === input.expectedRule.ruleId
  );
  if (matchingRules.length !== 1) fail("The exact Vercel API edge rule is not uniquely active.");

  for (const item of config.rules) {
    const candidate = record(item, "Vercel active firewall rule");
    if (candidate.active !== true) continue;
    if (candidate.valid !== true) fail("An active Vercel firewall rule is invalid.");
    const candidateAction = isRecord(candidate.action) && isRecord(candidate.action.mitigate)
      ? candidate.action.mitigate
      : undefined;
    if (!candidateAction) fail("An active Vercel firewall rule has no mitigation action.");
    assertSafeLoggedHeaders(candidateAction.logHeaders, "An active Vercel rule header log configuration");
    if (candidateAction.bypassSystem === true || candidateAction.action === "bypass") {
      fail("An active Vercel custom bypass exists.");
    }
  }

  const rule = record(matchingRules[0], "Vercel API edge rule");
  if (rule.active !== true || rule.valid !== true) fail("The Vercel API edge rule is not valid and active.");
  if (!Array.isArray(rule.conditionGroup) || rule.conditionGroup.length !== 1) {
    fail("The Vercel API edge rule must have one exact AND condition group.");
  }
  const group = record(rule.conditionGroup[0], "Vercel API edge condition group");
  if (!Array.isArray(group.conditions) || group.conditions.length !== 2) {
    fail("The Vercel API edge rule must match only host and path.");
  }
  const hasHost = group.conditions.some((condition) => conditionMatches(condition, {
    type: "host",
    op: "eq",
    value: API_EDGE_HOST
  }));
  const hasPath = group.conditions.some((condition) => conditionMatches(condition, {
    type: "path",
    op: "pre",
    value: API_EDGE_PATH_PREFIX
  }));
  if (!hasHost || !hasPath) fail("The Vercel API edge host or path condition is invalid.");

  const action = record(rule.action, "Vercel API edge action");
  const mitigate = record(action.mitigate, "Vercel API edge mitigation");
  if (mitigate.action !== "rate_limit") fail("The Vercel API edge rule is not a rate limit.");
  if (mitigate.bypassSystem === true) fail("The Vercel API edge rule bypasses system protection.");
  assertSafeLoggedHeaders(mitigate.logHeaders, "The Vercel API edge rule header log configuration");
  const rateLimit = record(mitigate.rateLimit, "Vercel API edge rate limit");
  if (rateLimit.algo !== "fixed_window") fail("The Vercel API edge rule must use a fixed window.");
  const limit = integerValue(rateLimit.limit, "The Vercel API edge limit", 1, 60);
  const windowSeconds = integerValue(rateLimit.window, "The Vercel API edge window", 10, 600);
  if (!Array.isArray(rateLimit.keys) || rateLimit.keys.length !== 1 || rateLimit.keys[0] !== "ip") {
    fail("The Vercel API edge rule must use only the provider-derived IP key.");
  }
  const followupAction = rateAction(rateLimit.action, "The Vercel API edge rate action");
  const durationSeconds = actionDurationSeconds(mitigate.actionDuration);

  if (input.expectedRule.limit !== undefined && limit !== input.expectedRule.limit) {
    fail("The Vercel API edge limit does not match the protected expectation.");
  }
  if (
    input.expectedRule.windowSeconds !== undefined &&
    windowSeconds !== input.expectedRule.windowSeconds
  ) {
    fail("The Vercel API edge window does not match the protected expectation.");
  }
  if (input.expectedRule.rateAction !== undefined && followupAction !== input.expectedRule.rateAction) {
    fail("The Vercel API edge action does not match the protected expectation.");
  }

  const activeBypasses = activeSystemBypassCount(input.systemBypasses, observedAt);
  if (activeBypasses !== 0) fail("An active Vercel project or domain system bypass exists.");
  const id = stringValue(config.id, "The Vercel firewall configuration ID", PROVIDER_ID_PATTERN);
  const version = integerValue(config.version, "The Vercel firewall configuration version", 0, Number.MAX_SAFE_INTEGER);
  const updatedAt = timestampValue(config.updatedAt, "The Vercel firewall update time");
  if (updatedAt.milliseconds > observedAt.getTime() + 5 * 60 * 1_000) {
    fail("The Vercel firewall update time is in the future.");
  }

  return {
    firewallConfig: {
      id,
      version,
      updatedAt: updatedAt.text,
      sha256: sha256Json(input.activeConfig)
    },
    rule: {
      id: stringValue(rule.id, "The Vercel API edge rule ID", PROVIDER_ID_PATTERN),
      host: API_EDGE_HOST,
      pathPrefix: API_EDGE_PATH_PREFIX,
      active: true,
      valid: true,
      algorithm: "fixed_window",
      windowSeconds,
      limit,
      keys: ["ip"],
      action: followupAction,
      actionDurationSeconds: durationSeconds
    },
    activeProjectOrDomainBypasses: 0
  };
}

function parseProbe(
  value: unknown,
  rule: ApiEdgeConfigurationProjection["rule"],
  directOrigin: string,
  capturedAtMilliseconds: number
): ApiEdgeEvidence["probe"] {
  const probe = record(value, "API edge probe result");
  exactKeys(probe, [
    "canonicalOrigin",
    "startedAt",
    "completedAt",
    "ordinaryStatus",
    "rateLimitedStatus",
    "requestsSent",
    "rateLimitedResponses",
    "directOriginStatus",
    "directOriginProtectionVerified",
    "responseLeakageObserved",
    "providerLogsReviewed"
  ], "API edge probe result");
  if (probe.canonicalOrigin !== API_EDGE_CANONICAL_ORIGIN) fail("The API edge probe origin is invalid.");
  const startedAt = timestampValue(probe.startedAt, "The API edge probe start time");
  const completedAt = timestampValue(probe.completedAt, "The API edge probe completion time");
  if (
    completedAt.milliseconds < startedAt.milliseconds ||
    completedAt.milliseconds > capturedAtMilliseconds + 60_000 ||
    capturedAtMilliseconds - startedAt.milliseconds > 30 * 60 * 1_000
  ) {
    fail("The API edge probe time window is invalid.");
  }
  if (probe.ordinaryStatus !== 401 && probe.ordinaryStatus !== 404) {
    fail("The API edge probe did not observe an ordinary unauthenticated response.");
  }
  if (probe.rateLimitedStatus !== 429) fail("The API edge probe did not observe a 429 response.");
  const requestsSent = integerValue(
    probe.requestsSent,
    "The API edge probe request count",
    3,
    62
  );
  if (requestsSent !== rule.limit + 2) fail("The API edge probe request count is not threshold-bound.");
  const rateLimitedResponses = integerValue(
    probe.rateLimitedResponses,
    "The API edge probe limited response count",
    1,
    requestsSent - 1
  );
  if (probe.directOriginStatus !== 401 && probe.directOriginStatus !== 403) {
    fail("The direct Vercel origin is not protected.");
  }
  if (probe.directOriginProtectionVerified !== true) {
    fail("The direct Vercel origin did not return the deployment-protection page.");
  }
  if (probe.responseLeakageObserved !== false) fail("The API edge probe observed response leakage.");
  if (probe.providerLogsReviewed !== true) fail("The provider log redaction review is missing.");
  let directUrl: URL;
  try {
    directUrl = new URL(directOrigin);
  } catch {
    return fail("The direct Vercel origin is invalid.");
  }
  if (
    directUrl.protocol !== "https:" ||
    directUrl.username !== "" ||
    directUrl.password !== "" ||
    directUrl.port !== "" ||
    directUrl.pathname !== "/" ||
    directUrl.search !== "" ||
    directUrl.hash !== "" ||
    !/^[a-z0-9-]+\.vercel\.app$/u.test(directUrl.hostname) ||
    directUrl.origin === API_EDGE_CANONICAL_ORIGIN
  ) {
    fail("The direct Vercel origin is invalid.");
  }

  return {
    startedAt: startedAt.text,
    completedAt: completedAt.text,
    ordinaryStatus: probe.ordinaryStatus,
    rateLimitedStatus: 429,
    requestsSent,
    rateLimitedResponses,
    directOriginStatus: probe.directOriginStatus,
    directOriginDenied: true,
    directOriginProtectionVerified: true,
    directOriginSha256: sha256Text(directUrl.origin),
    responseLeakageObserved: false,
    providerLogsReviewed: true
  };
}

export function createApiEdgeEvidence(input: {
  activeConfig: unknown;
  systemBypasses: unknown;
  probe: unknown;
  expectedRule: ApiEdgeRuleExpectation;
  repository: string;
  releaseCommit: string;
  runId: string;
  runAttempt: string;
  providerProjectId: string;
  directOrigin: string;
  capturedAt?: Date;
}): ApiEdgeEvidence {
  const capturedAt = input.capturedAt ?? new Date();
  if (!Number.isFinite(capturedAt.getTime())) fail("The API edge capture time is invalid.");
  const repository = stringValue(input.repository, "The evidence repository", REPOSITORY_PATTERN);
  const releaseCommit = stringValue(input.releaseCommit, "The evidence release commit", COMMIT_PATTERN);
  const runId = stringValue(input.runId, "The evidence workflow run ID", POSITIVE_INTEGER_PATTERN);
  const runAttempt = stringValue(
    input.runAttempt,
    "The evidence workflow run attempt",
    POSITIVE_INTEGER_PATTERN
  );
  const providerProjectId = stringValue(
    input.providerProjectId,
    "The Vercel project ID",
    PROVIDER_ID_PATTERN
  );
  const projection = inspectVercelApiEdgeConfiguration({
    activeConfig: input.activeConfig,
    systemBypasses: input.systemBypasses,
    expectedRule: input.expectedRule,
    observedAt: capturedAt
  });
  const probe = parseProbe(input.probe, projection.rule, input.directOrigin, capturedAt.getTime());

  return {
    schemaVersion: 1,
    provider: "vercel-waf",
    repository,
    releaseCommit,
    workflow: { runId, runAttempt },
    capturedAt: capturedAt.toISOString(),
    expiresAt: new Date(capturedAt.getTime() + API_EDGE_EVIDENCE_TTL_MS).toISOString(),
    canonicalOrigin: API_EDGE_CANONICAL_ORIGIN,
    providerProjectIdSha256: sha256Text(providerProjectId),
    firewallConfig: projection.firewallConfig,
    rule: projection.rule,
    bypasses: { activeProjectOrDomain: 0 },
    probe
  };
}

function intrinsicEvidence(value: unknown, currentTime: Date): ApiEdgeEvidence {
  const evidence = record(value, "API edge evidence");
  exactKeys(evidence, [
    "schemaVersion",
    "provider",
    "repository",
    "releaseCommit",
    "workflow",
    "capturedAt",
    "expiresAt",
    "canonicalOrigin",
    "providerProjectIdSha256",
    "firewallConfig",
    "rule",
    "bypasses",
    "probe"
  ], "API edge evidence");
  if (evidence.schemaVersion !== 1 || evidence.provider !== "vercel-waf") {
    fail("The API edge evidence schema is unsupported.");
  }
  stringValue(evidence.repository, "The evidence repository", REPOSITORY_PATTERN);
  stringValue(evidence.releaseCommit, "The evidence release commit", COMMIT_PATTERN);
  if (evidence.canonicalOrigin !== API_EDGE_CANONICAL_ORIGIN) fail("The evidence origin is invalid.");
  stringValue(evidence.providerProjectIdSha256, "The evidence project digest", SHA256_PATTERN);
  const workflow = record(evidence.workflow, "The evidence workflow metadata");
  exactKeys(workflow, ["runId", "runAttempt"], "The evidence workflow metadata");
  stringValue(workflow.runId, "The evidence workflow run ID", POSITIVE_INTEGER_PATTERN);
  stringValue(workflow.runAttempt, "The evidence workflow run attempt", POSITIVE_INTEGER_PATTERN);

  const capturedAt = timestampValue(evidence.capturedAt, "The evidence capture time");
  const expiresAt = timestampValue(evidence.expiresAt, "The evidence expiry time");
  if (expiresAt.milliseconds - capturedAt.milliseconds !== API_EDGE_EVIDENCE_TTL_MS) {
    fail("The API edge evidence expiry is invalid.");
  }
  if (!Number.isFinite(currentTime.getTime())) fail("The evidence validation clock is invalid.");
  if (capturedAt.milliseconds > currentTime.getTime() + 5 * 60 * 1_000) {
    fail("The API edge evidence was captured in the future.");
  }
  if (currentTime.getTime() >= expiresAt.milliseconds) fail("The API edge evidence has expired.");

  const firewallConfig = record(evidence.firewallConfig, "The evidence firewall configuration");
  exactKeys(firewallConfig, ["id", "version", "updatedAt", "sha256"], "The evidence firewall configuration");
  stringValue(firewallConfig.id, "The evidence firewall configuration ID", PROVIDER_ID_PATTERN);
  integerValue(firewallConfig.version, "The evidence firewall configuration version", 0, Number.MAX_SAFE_INTEGER);
  const firewallUpdatedAt = timestampValue(
    firewallConfig.updatedAt,
    "The evidence firewall update time"
  );
  if (firewallUpdatedAt.milliseconds > capturedAt.milliseconds + 5 * 60 * 1_000) {
    fail("The evidence firewall update time is invalid.");
  }
  stringValue(firewallConfig.sha256, "The evidence firewall digest", SHA256_PATTERN);

  const rule = record(evidence.rule, "The evidence API edge rule");
  exactKeys(rule, [
    "id",
    "host",
    "pathPrefix",
    "active",
    "valid",
    "algorithm",
    "windowSeconds",
    "limit",
    "keys",
    "action",
    "actionDurationSeconds"
  ], "The evidence API edge rule");
  stringValue(rule.id, "The evidence API edge rule ID", PROVIDER_ID_PATTERN);
  if (
    rule.host !== API_EDGE_HOST ||
    rule.pathPrefix !== API_EDGE_PATH_PREFIX ||
    rule.active !== true ||
    rule.valid !== true ||
    rule.algorithm !== "fixed_window"
  ) fail("The evidence API edge rule contract is invalid.");
  const limit = integerValue(rule.limit, "The evidence API edge limit", 1, 60);
  integerValue(rule.windowSeconds, "The evidence API edge window", 10, 600);
  if (!Array.isArray(rule.keys) || rule.keys.length !== 1 || rule.keys[0] !== "ip") {
    fail("The evidence API edge key is invalid.");
  }
  rateAction(rule.action, "The evidence API edge action");
  if (rule.actionDurationSeconds !== null) {
    integerValue(rule.actionDurationSeconds, "The evidence API edge action duration", 1, 3_600);
  }

  const bypasses = record(evidence.bypasses, "The evidence bypass result");
  exactKeys(bypasses, ["activeProjectOrDomain"], "The evidence bypass result");
  if (bypasses.activeProjectOrDomain !== 0) fail("The evidence records an active bypass.");

  const probe = record(evidence.probe, "The evidence API edge probe");
  exactKeys(probe, [
    "startedAt",
    "completedAt",
    "ordinaryStatus",
    "rateLimitedStatus",
    "requestsSent",
    "rateLimitedResponses",
    "directOriginStatus",
    "directOriginDenied",
    "directOriginProtectionVerified",
    "directOriginSha256",
    "responseLeakageObserved",
    "providerLogsReviewed"
  ], "The evidence API edge probe");
  const probeStartedAt = timestampValue(probe.startedAt, "The evidence probe start time");
  const probeCompletedAt = timestampValue(probe.completedAt, "The evidence probe completion time");
  if (
    probeCompletedAt.milliseconds < probeStartedAt.milliseconds ||
    probeCompletedAt.milliseconds > capturedAt.milliseconds + 60_000 ||
    capturedAt.milliseconds - probeStartedAt.milliseconds > 30 * 60 * 1_000
  ) fail("The evidence probe time window is invalid.");
  if (probe.ordinaryStatus !== 401 && probe.ordinaryStatus !== 404) {
    fail("The evidence ordinary probe status is invalid.");
  }
  if (probe.rateLimitedStatus !== 429) fail("The evidence rate-limit status is invalid.");
  const requestsSent = integerValue(probe.requestsSent, "The evidence probe request count", 3, 62);
  if (requestsSent !== limit + 2) fail("The evidence probe was not bounded to the configured threshold.");
  integerValue(
    probe.rateLimitedResponses,
    "The evidence limited response count",
    1,
    requestsSent - 1
  );
  if (probe.directOriginStatus !== 401 && probe.directOriginStatus !== 403) {
    fail("The evidence direct-origin status is invalid.");
  }
  if (
    probe.directOriginDenied !== true ||
    probe.directOriginProtectionVerified !== true ||
    probe.responseLeakageObserved !== false ||
    probe.providerLogsReviewed !== true
  ) fail("The evidence probe safety assertions are invalid.");
  stringValue(probe.directOriginSha256, "The evidence direct-origin digest", SHA256_PATTERN);

  return evidence as unknown as ApiEdgeEvidence;
}

export function validateApiEdgeEvidence(
  value: unknown,
  expected: ApiEdgeEvidenceExpectation = {},
  currentTime: Date = new Date()
): ApiEdgeEvidence {
  const evidence = intrinsicEvidence(value, currentTime);
  if (expected.releaseCommit !== undefined && evidence.releaseCommit !== expected.releaseCommit) {
    fail("The API edge evidence is for a different release commit.");
  }
  if (expected.repository !== undefined && evidence.repository !== expected.repository) {
    fail("The API edge evidence is for a different repository.");
  }
  if (expected.runId !== undefined && evidence.workflow.runId !== expected.runId) {
    fail("The API edge evidence is for a different workflow run.");
  }
  if (expected.runAttempt !== undefined && evidence.workflow.runAttempt !== expected.runAttempt) {
    fail("The API edge evidence is for a different workflow run attempt.");
  }
  return evidence;
}

export function verifyLiveApiEdgeConfiguration(input: {
  evidence: unknown;
  activeConfig: unknown;
  systemBypasses: unknown;
  observedAt?: Date;
}): ApiEdgeEvidence {
  const observedAt = input.observedAt ?? new Date();
  const evidence = validateApiEdgeEvidence(input.evidence, {}, observedAt);
  const current = inspectVercelApiEdgeConfiguration({
    activeConfig: input.activeConfig,
    systemBypasses: input.systemBypasses,
    expectedRule: {
      ruleId: evidence.rule.id,
      limit: evidence.rule.limit,
      windowSeconds: evidence.rule.windowSeconds,
      rateAction: evidence.rule.action
    },
    observedAt
  });
  if (
    JSON.stringify(current.firewallConfig) !== JSON.stringify(evidence.firewallConfig) ||
    JSON.stringify(current.rule) !== JSON.stringify(evidence.rule) ||
    current.activeProjectOrDomainBypasses !== evidence.bypasses.activeProjectOrDomain
  ) {
    fail("The live Vercel API edge configuration has drifted from the attested evidence.");
  }
  return evidence;
}
