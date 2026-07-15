import { describe, expect, it } from "vitest";

import {
  API_EDGE_EVIDENCE_TTL_MS,
  ApiEdgeEvidenceValidationError,
  createApiEdgeEvidence,
  inspectVercelApiEdgeConfiguration,
  sha256Json,
  validateApiEdgeEvidence,
  verifyLiveApiEdgeConfiguration
} from "@/lib/api-edge-evidence";

const capturedAt = new Date("2026-07-15T12:00:10.000Z");
const releaseCommit = "a".repeat(40);

function activeConfig() {
  return {
    ownerId: "team_private_owner",
    projectKey: "project_private_key",
    id: "icfg_beta_17",
    version: 17,
    updatedAt: "2026-07-15T11:59:00.000Z",
    firewallEnabled: true,
    rules: [
      {
        id: "rule_beta_api",
        name: "Private operator rule name",
        description: "Private operator description",
        active: true,
        conditionGroup: [
          {
            conditions: [
              { type: "host", op: "eq", neg: false, value: "app.kinresolve.com" },
              { type: "path", op: "pre", neg: false, value: "/api/v1/" }
            ]
          }
        ],
        action: {
          mitigate: {
            action: "rate_limit",
            rateLimit: {
              algo: "fixed_window",
              window: 60,
              limit: 5,
              keys: ["ip"],
              action: "rate_limit"
            },
            actionDuration: "60s",
            bypassSystem: false,
            logHeaders: ["x-request-id"]
          }
        },
        valid: true,
        validationErrors: null
      }
    ],
    ips: [] as Array<{ id: string; hostname: string; ip: string; action: string }>,
    changes: [] as unknown[],
    logHeaders: ["x-request-id"]
  };
}

function emptyBypasses() {
  return { result: [] };
}

function probe(at = capturedAt) {
  return {
    canonicalOrigin: "https://app.kinresolve.com",
    startedAt: new Date(at.getTime() - 9_000).toISOString(),
    completedAt: new Date(at.getTime() - 1_000).toISOString(),
    ordinaryStatus: 404,
    rateLimitedStatus: 429,
    requestsSent: 7,
    rateLimitedResponses: 2,
    directOriginStatus: 401,
    directOriginProtectionVerified: true,
    responseLeakageObserved: false,
    providerLogsReviewed: true
  };
}

function evidence() {
  return createApiEdgeEvidence({
    activeConfig: activeConfig(),
    systemBypasses: emptyBypasses(),
    probe: probe(),
    expectedRule: {
      ruleId: "rule_beta_api",
      limit: 5,
      windowSeconds: 60,
      rateAction: "rate_limit"
    },
    repository: "kinresolve/kinresolve",
    releaseCommit,
    runId: "123456789",
    runAttempt: "2",
    providerProjectId: "prj_private_provider_identifier",
    directOrigin: "https://kinresolve-private-sha.vercel.app",
    capturedAt
  });
}

describe("API edge evidence", () => {
  it("projects the official Vercel response into a sanitized, SHA-bound receipt", () => {
    const result = evidence();
    expect(result).toMatchObject({
      schemaVersion: 1,
      provider: "vercel-waf",
      repository: "kinresolve/kinresolve",
      releaseCommit,
      workflow: { runId: "123456789", runAttempt: "2" },
      canonicalOrigin: "https://app.kinresolve.com",
      firewallConfig: {
        id: "icfg_beta_17",
        version: 17,
        updatedAt: "2026-07-15T11:59:00.000Z",
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/)
      },
      rule: {
        id: "rule_beta_api",
        host: "app.kinresolve.com",
        pathPrefix: "/api/v1/",
        active: true,
        valid: true,
        algorithm: "fixed_window",
        windowSeconds: 60,
        limit: 5,
        keys: ["ip"],
        action: "rate_limit",
        actionDurationSeconds: 60
      },
      bypasses: { activeProjectOrDomain: 0 },
      probe: {
        ordinaryStatus: 404,
        rateLimitedStatus: 429,
        requestsSent: 7,
        rateLimitedResponses: 2,
        directOriginStatus: 401,
        directOriginDenied: true,
        directOriginProtectionVerified: true,
        responseLeakageObserved: false,
        providerLogsReviewed: true
      }
    });
    expect(Date.parse(result.expiresAt) - Date.parse(result.capturedAt)).toBe(API_EDGE_EVIDENCE_TTL_MS);
    const serialized = JSON.stringify(result);
    for (const privateValue of [
      "team_private_owner",
      "project_private_key",
      "prj_private_provider_identifier",
      "kinresolve-private-sha.vercel.app",
      "Private operator rule name",
      "Private operator description"
    ]) expect(serialized).not.toContain(privateValue);
  });

  it("uses a stable full-configuration digest independent of object key order", () => {
    expect(sha256Json({ b: 2, a: { d: 4, c: 3 } })).toBe(
      sha256Json({ a: { c: 3, d: 4 }, b: 2 })
    );
    const config = activeConfig();
    expect(evidence().firewallConfig.sha256).toBe(sha256Json(config));
  });

  it.each([
    ["disabled firewall", (config: ReturnType<typeof activeConfig>) => { config.firewallEnabled = false; }],
    ["inactive exact rule", (config: ReturnType<typeof activeConfig>) => { config.rules[0]!.active = false; }],
    ["wrong host", (config: ReturnType<typeof activeConfig>) => { config.rules[0]!.conditionGroup[0]!.conditions[0]!.value = "example.com"; }],
    ["extra method condition", (config: ReturnType<typeof activeConfig>) => { config.rules[0]!.conditionGroup[0]!.conditions.push({ type: "method", op: "eq", neg: false, value: "GET" }); }],
    ["Authorization logging", (config: ReturnType<typeof activeConfig>) => { config.logHeaders = ["Authorization"]; }],
    ["Cookie logging", (config: ReturnType<typeof activeConfig>) => { config.logHeaders = ["COOKIE"]; }],
    ["Vercel bypass logging", (config: ReturnType<typeof activeConfig>) => { config.rules[0]!.action.mitigate.logHeaders = [" X-Vercel-Protection-Bypass "]; }],
    ["operator signature logging", (config: ReturnType<typeof activeConfig>) => { config.rules[0]!.action.mitigate.logHeaders = ["x-kinresolve-operator-signature"]; }],
    ["multiple logged headers", (config: ReturnType<typeof activeConfig>) => { config.logHeaders = ["x-request-id", "x-request-id"]; }],
    ["403 deny follow-up", (config: ReturnType<typeof activeConfig>) => { config.rules[0]!.action.mitigate.rateLimit.action = "deny"; }],
    ["provider-system bypass", (config: ReturnType<typeof activeConfig>) => { config.rules[0]!.action.mitigate.bypassSystem = true; }],
    ["IP bypass", (config: ReturnType<typeof activeConfig>) => { config.ips.push({ id: "ip_1", hostname: "*", ip: "192.0.2.1", action: "bypass" }); }],
    ["caller-controlled key", (config: ReturnType<typeof activeConfig>) => { config.rules[0]!.action.mitigate.rateLimit.keys = ["header:x-forwarded-for"]; }]
  ])("rejects the %s provider shape", (_label, mutate) => {
    const config = activeConfig();
    mutate(config);
    expect(() => inspectVercelApiEdgeConfiguration({
      activeConfig: config,
      systemBypasses: emptyBypasses(),
      expectedRule: { ruleId: "rule_beta_api", limit: 5, windowSeconds: 60 },
      observedAt: capturedAt
    })).toThrow(ApiEdgeEvidenceValidationError);
  });

  it("accepts no logged headers or the single privacy-safe request identifier", () => {
    const none = activeConfig();
    delete (none as Partial<ReturnType<typeof activeConfig>>).logHeaders;
    delete (none.rules[0]!.action.mitigate as Partial<typeof none.rules[0]["action"]["mitigate"]>).logHeaders;
    expect(() => inspectVercelApiEdgeConfiguration({
      activeConfig: none,
      systemBypasses: emptyBypasses(),
      expectedRule: { ruleId: "rule_beta_api" },
      observedAt: capturedAt
    })).not.toThrow();

    const requestIdOnly = activeConfig();
    requestIdOnly.logHeaders = [" X-Request-Id "];
    requestIdOnly.rules[0]!.action.mitigate.logHeaders = ["X-REQUEST-ID"];
    expect(() => inspectVercelApiEdgeConfiguration({
      activeConfig: requestIdOnly,
      systemBypasses: emptyBypasses(),
      expectedRule: { ruleId: "rule_beta_api" },
      observedAt: capturedAt
    })).not.toThrow();
  });

  it("rejects active custom and project/domain system bypass shapes", () => {
    const customBypass = activeConfig();
    customBypass.rules.push({
      ...structuredClone(customBypass.rules[0]!),
      id: "rule_unrelated_bypass",
      action: { mitigate: { ...customBypass.rules[0]!.action.mitigate, action: "bypass" } }
    });
    expect(() => inspectVercelApiEdgeConfiguration({
      activeConfig: customBypass,
      systemBypasses: emptyBypasses(),
      expectedRule: { ruleId: "rule_beta_api" },
      observedAt: capturedAt
    })).toThrow(/custom bypass/i);

    expect(() => inspectVercelApiEdgeConfiguration({
      activeConfig: activeConfig(),
      systemBypasses: {
        result: [{ Action: "bypass", Domain: "app.kinresolve.com", DeletedAt: null, ExpiresAt: null }]
      },
      expectedRule: { ruleId: "rule_beta_api" },
      observedAt: capturedAt
    })).toThrow(/project or domain system bypass/i);
  });

  it("accepts only inactive historical bypass entries and a bounded official response", () => {
    expect(() => inspectVercelApiEdgeConfiguration({
      activeConfig: activeConfig(),
      systemBypasses: {
        result: [
          { Action: "bypass", DeletedAt: "2026-07-14T00:00:00.000Z", ExpiresAt: null },
          { Action: "bypass", DeletedAt: null, ExpiresAt: capturedAt.getTime() - 1 },
          { Action: "block", DeletedAt: null, ExpiresAt: null }
        ]
      },
      expectedRule: { ruleId: "rule_beta_api" },
      observedAt: capturedAt
    })).not.toThrow();
  });

  it("fails closed when the provider advertises an uninspected bypass page", () => {
    expect(() => inspectVercelApiEdgeConfiguration({
      activeConfig: activeConfig(),
      systemBypasses: {
        result: [],
        pagination: { OwnerId: "team_private_owner", Id: "bypass_private_cursor" }
      },
      expectedRule: { ruleId: "rule_beta_api" },
      observedAt: capturedAt
    })).toThrow(/pagination is not provably complete/i);

    expect(() => inspectVercelApiEdgeConfiguration({
      activeConfig: activeConfig(),
      systemBypasses: { result: [], pagination: {} },
      expectedRule: { ruleId: "rule_beta_api" },
      observedAt: capturedAt
    })).not.toThrow();
  });

  it("validates exact run identity, freshness, and a closed receipt schema", () => {
    const value = evidence();
    expect(validateApiEdgeEvidence(value, {
      releaseCommit,
      repository: "kinresolve/kinresolve",
      runId: "123456789",
      runAttempt: "2"
    }, new Date("2026-07-16T11:59:59.999Z"))).toEqual(value);
    expect(() => validateApiEdgeEvidence(value, { runId: "9" }, capturedAt)).toThrow(/different workflow run/i);
    expect(() => validateApiEdgeEvidence(value, {}, new Date(value.expiresAt))).toThrow(/expired/i);
    expect(() => validateApiEdgeEvidence({ ...value, rawProviderResponse: "secret" }, {}, capturedAt))
      .toThrow(/unexpected field/i);
  });

  it("rejects a direct-origin app response that lacks positive deployment-protection proof", () => {
    expect(() => createApiEdgeEvidence({
      activeConfig: activeConfig(),
      systemBypasses: emptyBypasses(),
      probe: { ...probe(), directOriginProtectionVerified: false },
      expectedRule: { ruleId: "rule_beta_api" },
      repository: "kinresolve/kinresolve",
      releaseCommit,
      runId: "123456789",
      runAttempt: "2",
      providerProjectId: "prj_private_provider_identifier",
      directOrigin: "https://kinresolve-private-sha.vercel.app",
      capturedAt
    })).toThrow(/deployment-protection page/i);
  });

  it("rechecks the complete live configuration and fails closed on any drift", () => {
    const value = evidence();
    expect(verifyLiveApiEdgeConfiguration({
      evidence: value,
      activeConfig: activeConfig(),
      systemBypasses: emptyBypasses(),
      observedAt: capturedAt
    })).toEqual(value);

    const drifted = activeConfig();
    drifted.changes.push("unrelated-live-drift");
    expect(() => verifyLiveApiEdgeConfiguration({
      evidence: value,
      activeConfig: drifted,
      systemBypasses: emptyBypasses(),
      observedAt: capturedAt
    })).toThrow(/drifted/i);
    expect(() => verifyLiveApiEdgeConfiguration({
      evidence: value,
      activeConfig: activeConfig(),
      systemBypasses: { result: [{ Action: "bypass", DeletedAt: null, ExpiresAt: null }] },
      observedAt: capturedAt
    })).toThrow(/bypass/i);
  });
});
