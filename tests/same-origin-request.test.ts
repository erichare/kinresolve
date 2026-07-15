import { describe, expect, it } from "vitest";

import {
  browserCanaryMutationAcknowledgement,
  identityCanaryMutationAcknowledgement,
  insecureLoopbackCanaryOriginAcknowledgement,
  resolveInsecureLoopbackProductionCanaryProfile
} from "@/lib/insecure-loopback-canary";
import { evaluateSameOriginRequest } from "@/lib/same-origin-request";

const productionEnvironment = {
  NODE_ENV: "production",
  APP_BASE_URL: "https://app.kinresolve.com"
} as const;

const releaseSha = "a".repeat(40);
const browserLoopbackEnvironment: Record<string, string | undefined> = {
  NODE_ENV: "production",
  APP_BASE_URL: "http://127.0.0.1:3107",
  DATABASE_AUTO_MIGRATE: "false",
  DATABASE_URL: "postgres://kinresolve:kinresolve@127.0.0.1:5432/kinresolve_browser_canary",
  KINSLEUTH_ARCHIVE_ID: "archive-browser-canary",
  KINRESOLVE_BUILD_COMMIT_SHA: releaseSha,
  KINRESOLVE_CANARY_ALLOW_MUTATION: "true",
  KINRESOLVE_CANARY_APP_BASE_URL: "http://127.0.0.1:3107",
  KINRESOLVE_CANARY_ARCHIVE_ID: "archive-browser-canary",
  KINRESOLVE_CANARY_DATASET_MODE: "demo",
  KINRESOLVE_CANARY_MUTATION_ACKNOWLEDGEMENT: browserCanaryMutationAcknowledgement,
  KINRESOLVE_CANARY_OPERATOR_DATABASE_URL:
    "postgres://kinresolve:kinresolve@127.0.0.1:5432/kinresolve_browser_canary",
  KINRESOLVE_CANARY_ORIGIN: "http://127.0.0.1:3107",
  KINRESOLVE_CANARY_RELEASE_SHA: releaseSha,
  KINRESOLVE_DATASET_MODE: "demo",
  KINRESOLVE_DEPLOYMENT_MODE: "self-hosted",
  KINRESOLVE_INSECURE_LOOPBACK_CANARY_ORIGIN: "true",
  KINRESOLVE_INSECURE_LOOPBACK_CANARY_ACKNOWLEDGEMENT:
    insecureLoopbackCanaryOriginAcknowledgement,
  KINRESOLVE_OBJECT_STORAGE_BACKEND: "s3",
  S3_ENDPOINT: "http://127.0.0.1:39000",
  S3_PUBLIC_ENDPOINT: "http://127.0.0.1:39000"
};

const identityLoopbackEnvironment: Record<string, string | undefined> = {
  NODE_ENV: "production",
  APP_BASE_URL: "http://127.0.0.1:3117",
  DATABASE_AUTO_MIGRATE: "false",
  DATABASE_URL: "postgres://kinresolve:kinresolve@127.0.0.1:5432/kinresolve_identity_canary",
  KINSLEUTH_ARCHIVE_ID: "archive-identity-canary",
  KINRESOLVE_BUILD_COMMIT_SHA: releaseSha,
  KINRESOLVE_CANARY_RELEASE_SHA: releaseSha,
  KINRESOLVE_DATASET_MODE: "demo",
  KINRESOLVE_IDENTITY_CANARY_ALLOW_MUTATION: "true",
  KINRESOLVE_IDENTITY_CANARY_MUTATION_ACKNOWLEDGEMENT: identityCanaryMutationAcknowledgement,
  KINRESOLVE_IDENTITY_CANARY_ORIGIN: "http://127.0.0.1:3117",
  KINRESOLVE_INSECURE_LOOPBACK_CANARY_ORIGIN: "true",
  KINRESOLVE_INSECURE_LOOPBACK_CANARY_ACKNOWLEDGEMENT:
    insecureLoopbackCanaryOriginAcknowledgement
};

describe("same-origin cookie request policy", () => {
  it("accepts only the exact canonical origin and same-origin fetch metadata", () => {
    expect(evaluateSameOriginRequest(request({
      origin: "https://app.kinresolve.com",
      fetchSite: "same-origin"
    }), productionEnvironment)).toBe("allowed");
  });

  it.each([
    undefined,
    "null",
    "https://kinresolve.com",
    "https://preview.app.kinresolve.com",
    "http://app.kinresolve.com",
    "https://app.kinresolve.com:444",
    "https://app.kinresolve.com/",
    "https://app.kinresolve.com, https://attacker.example"
  ])("rejects the non-canonical Origin value %s", (origin) => {
    expect(evaluateSameOriginRequest(request({ origin, fetchSite: "same-origin" }), productionEnvironment))
      .toBe("forbidden");
  });

  it.each([undefined, "same-site", "cross-site", "none", "SAME-ORIGIN"])(
    "rejects the Fetch Metadata value %s",
    (fetchSite) => {
      expect(evaluateSameOriginRequest(request({
        origin: "https://app.kinresolve.com",
        fetchSite
      }), productionEnvironment)).toBe("forbidden");
    }
  );

  it.each([
    {},
    { APP_BASE_URL: "not a URL" },
    { APP_BASE_URL: "http://app.kinresolve.com" },
    { APP_BASE_URL: "https://user:pass@app.kinresolve.com" },
    { APP_BASE_URL: "https://app.kinresolve.com/base" },
    { APP_BASE_URL: "https://app.kinresolve.com?query=1" },
    { APP_BASE_URL: "https://app.kinresolve.com#fragment" }
  ])("fails closed for the production canonical-origin configuration %#", (overrides) => {
    expect(evaluateSameOriginRequest(request({
      origin: "https://app.kinresolve.com",
      fetchSite: "same-origin"
    }), { NODE_ENV: "production", ...overrides })).toBe("misconfigured");
  });

  it("uses the request origin only when development has no configured canonical origin", () => {
    expect(evaluateSameOriginRequest(request({
      requestUrl: "http://localhost:3000/api/cases",
      origin: "http://localhost:3000",
      fetchSite: "same-origin"
    }), { NODE_ENV: "development" })).toBe("allowed");
    expect(evaluateSameOriginRequest(request({
      requestUrl: "http://localhost:3000/api/cases",
      origin: "http://127.0.0.1:3000",
      fetchSite: "same-origin"
    }), { NODE_ENV: "development" })).toBe("forbidden");
  });

  it("admits HTTP in production only for the exact isolated browser canary profile", () => {
    expect(evaluateSameOriginRequest(request({
      requestUrl: "http://127.0.0.1:3107/api/cases",
      origin: "http://127.0.0.1:3107",
      fetchSite: "same-origin"
    }), browserLoopbackEnvironment)).toBe("allowed");
  });

  it.each([
    ["explicit insecure-loopback opt-in", { KINRESOLVE_INSECURE_LOOPBACK_CANARY_ORIGIN: undefined }],
    ["insecure-loopback acknowledgement", {
      KINRESOLVE_INSECURE_LOOPBACK_CANARY_ACKNOWLEDGEMENT: "yes"
    }],
    ["disabled auto migration", { DATABASE_AUTO_MIGRATE: "true" }],
    ["global demo dataset", { KINRESOLVE_DATASET_MODE: "pilot" }],
    ["browser demo dataset", { KINRESOLVE_CANARY_DATASET_MODE: "pilot" }],
    ["exact mutation opt-in", { KINRESOLVE_CANARY_ALLOW_MUTATION: undefined }],
    ["exclusive mutation profile", { KINRESOLVE_IDENTITY_CANARY_ALLOW_MUTATION: "true" }],
    ["exact mutation acknowledgement", { KINRESOLVE_CANARY_MUTATION_ACKNOWLEDGEMENT: "yes" }],
    ["full release SHA", { KINRESOLVE_CANARY_RELEASE_SHA: "a".repeat(39) }],
    ["exact build/release binding", { KINRESOLVE_BUILD_COMMIT_SHA: "b".repeat(40) }],
    ["exact application origin", { APP_BASE_URL: "http://127.0.0.1:3108" }],
    ["exact browser origin", { KINRESOLVE_CANARY_ORIGIN: "http://127.0.0.1:3108" }],
    ["exact browser application origin", { KINRESOLVE_CANARY_APP_BASE_URL: "http://127.0.0.1:3108" }],
    ["numeric loopback host", { APP_BASE_URL: "http://localhost:3107" }],
    ["explicit non-default application port", { APP_BASE_URL: "http://127.0.0.1" }],
    ["exact canary archive", { KINRESOLVE_CANARY_ARCHIVE_ID: "archive-pilot" }],
    ["exact runtime archive", { KINSLEUTH_ARCHIVE_ID: "archive-pilot" }],
    ["exact disposable database", {
      DATABASE_URL: "postgres://kinresolve:kinresolve@127.0.0.1:5432/persistent_staging"
    }],
    ["numeric database loopback host", {
      DATABASE_URL: "postgres://kinresolve:kinresolve@localhost:5432/kinresolve_browser_canary"
    }],
    ["database password", {
      DATABASE_URL: "postgres://kinresolve@127.0.0.1:5432/kinresolve_browser_canary"
    }],
    ["explicit database port", {
      DATABASE_URL: "postgres://kinresolve:kinresolve@127.0.0.1/kinresolve_browser_canary"
    }],
    ["database URL without query overrides", {
      DATABASE_URL: "postgres://kinresolve:kinresolve@127.0.0.1:5432/kinresolve_browser_canary?host=db.example"
    }],
    ["exact operator database URL", {
      KINRESOLVE_CANARY_OPERATOR_DATABASE_URL:
        "postgres://kinresolve:kinresolve@127.0.0.1:5433/kinresolve_browser_canary"
    }],
    ["self-hosted deployment", { KINRESOLVE_DEPLOYMENT_MODE: "hosted" }],
    ["S3 storage backend", { KINRESOLVE_OBJECT_STORAGE_BACKEND: "local" }],
    ["loopback S3 endpoint", { S3_ENDPOINT: "https://storage.example.test" }],
    ["exact S3 public endpoint", { S3_PUBLIC_ENDPOINT: "http://127.0.0.1:39001" }]
  ])("fails closed when the browser loopback profile relaxes %s", (_label, override) => {
    expect(evaluateSameOriginRequest(request({
      requestUrl: "http://127.0.0.1:3107/api/cases",
      origin: "http://127.0.0.1:3107",
      fetchSite: "same-origin"
    }), { ...browserLoopbackEnvironment, ...override })).toBe("misconfigured");
  });

  it("never classifies the insecure loopback exception outside a production runtime", () => {
    expect(resolveInsecureLoopbackProductionCanaryProfile({
      ...browserLoopbackEnvironment,
      NODE_ENV: "development"
    })).toBeNull();
  });

  it.each([
    ["VERCEL", "present"],
    ["VERCEL_AUTOMATION_BYPASS_SECRET", ""],
    ["VERCEL_BRANCH_URL", "   "],
    ["VERCEL_ENV", "present"],
    ["VERCEL_OIDC_TOKEN", "present"],
    ["VERCEL_PROJECT_PRODUCTION_URL", "present"],
    ["VERCEL_TARGET_ENV", "present"],
    ["VERCEL_URL", "present"],
    ["VERCEL_FUTURE_RUNTIME_MARKER", "present"]
  ])("fails closed when the browser loopback environment contains %s", (name, value) => {
    expect(evaluateSameOriginRequest(request({
      requestUrl: "http://127.0.0.1:3107/api/cases",
      origin: "http://127.0.0.1:3107",
      fetchSite: "same-origin"
    }), { ...browserLoopbackEnvironment, [name]: value })).toBe("misconfigured");
  });

  it("admits the identity profile without browser storage or operator credentials", () => {
    expect(evaluateSameOriginRequest(request({
      requestUrl: "http://127.0.0.1:3117/api/operator/invitations",
      origin: "http://127.0.0.1:3117",
      fetchSite: "same-origin"
    }), identityLoopbackEnvironment)).toBe("allowed");
    expect(identityLoopbackEnvironment).not.toHaveProperty("S3_ENDPOINT");
    expect(identityLoopbackEnvironment).not.toHaveProperty("KINRESOLVE_CANARY_OPERATOR_DATABASE_URL");
  });

  it.each([
    ["global loopback acknowledgement", {
      KINRESOLVE_INSECURE_LOOPBACK_CANARY_ACKNOWLEDGEMENT: "yes"
    }],
    ["identity mutation opt-in", { KINRESOLVE_IDENTITY_CANARY_ALLOW_MUTATION: undefined }],
    ["exclusive identity profile", { KINRESOLVE_CANARY_ALLOW_MUTATION: "true" }],
    ["identity acknowledgement", { KINRESOLVE_IDENTITY_CANARY_MUTATION_ACKNOWLEDGEMENT: "yes" }],
    ["identity origin", { KINRESOLVE_IDENTITY_CANARY_ORIGIN: "http://127.0.0.1:3118" }],
    ["identity archive", { KINSLEUTH_ARCHIVE_ID: "archive-browser-canary" }],
    ["identity database path", {
      DATABASE_URL: "postgres://kinresolve:kinresolve@127.0.0.1:5432/kinresolve_browser_canary"
    }],
    ["identity database password", {
      DATABASE_URL: "postgres://kinresolve@127.0.0.1:5432/kinresolve_identity_canary"
    }],
    ["identity database port", {
      DATABASE_URL: "postgres://kinresolve:kinresolve@127.0.0.1/kinresolve_identity_canary"
    }]
  ])("fails closed when the identity loopback profile relaxes %s", (_label, override) => {
    expect(evaluateSameOriginRequest(request({
      requestUrl: "http://127.0.0.1:3117/api/operator/invitations",
      origin: "http://127.0.0.1:3117",
      fetchSite: "same-origin"
    }), { ...identityLoopbackEnvironment, ...override })).toBe("misconfigured");
  });
});

function request(input: {
  requestUrl?: string;
  origin?: string;
  fetchSite?: string;
}): Request {
  const headers = new Headers();
  if (input.origin !== undefined) headers.set("origin", input.origin);
  if (input.fetchSite !== undefined) headers.set("sec-fetch-site", input.fetchSite);
  return new Request(input.requestUrl ?? "https://release-preview.vercel.app/api/cases", {
    method: "POST",
    headers
  });
}
