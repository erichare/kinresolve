import { describe, expect, it } from "vitest";

import { resolvePublicDemoConfiguration } from "@/lib/public-demo-config";

const enabledDemoEnvironment = {
  NODE_ENV: "production",
  KINRESOLVE_DEPLOYMENT_MODE: "hosted",
  KINRESOLVE_DATASET_MODE: "demo",
  KINRESOLVE_PUBLIC_DEMO_ENABLED: "true",
  KINRESOLVE_PUBLIC_DEMO_ORIGIN: "https://demo.kinresolve.com",
  APP_BASE_URL: "https://demo.kinresolve.com"
} as const;

describe("public demo runtime configuration", () => {
  it("pins the public demo to the hosted fictional dataset and canonical origin", () => {
    expect(resolvePublicDemoConfiguration(enabledDemoEnvironment)).toEqual({
      enabled: true,
      origin: "https://demo.kinresolve.com",
      sessionDurationSeconds: 86_400,
      maximumActiveSessions: 25,
      maximumResets: 5,
      aiAttemptsPerSession: 3
    });
  });

  it("defaults the public demo off without silently assigning an origin", () => {
    expect(resolvePublicDemoConfiguration({
      KINRESOLVE_DEPLOYMENT_MODE: "self-hosted"
    })).toEqual({
      enabled: false,
      origin: null,
      sessionDurationSeconds: 86_400,
      maximumActiveSessions: 25,
      maximumResets: 5,
      aiAttemptsPerSession: 3
    });
  });

  it.each([
    {
      name: "self-hosted deployment",
      environment: { ...enabledDemoEnvironment, KINRESOLVE_DEPLOYMENT_MODE: "self-hosted" }
    },
    {
      name: "pilot dataset",
      environment: { ...enabledDemoEnvironment, KINRESOLVE_DATASET_MODE: "pilot" }
    },
    {
      name: "non-canonical origin",
      environment: { ...enabledDemoEnvironment, KINRESOLVE_PUBLIC_DEMO_ORIGIN: "https://app.kinresolve.com" }
    },
    {
      name: "origin with a path",
      environment: {
        ...enabledDemoEnvironment,
        KINRESOLVE_PUBLIC_DEMO_ORIGIN: "https://demo.kinresolve.com/app"
      }
    },
    {
      name: "missing origin",
      environment: { ...enabledDemoEnvironment, KINRESOLVE_PUBLIC_DEMO_ORIGIN: "" }
    },
    {
      name: "non-canonical app base URL",
      environment: { ...enabledDemoEnvironment, APP_BASE_URL: "https://candidate-team.vercel.app" }
    },
    {
      name: "missing app base URL",
      environment: { ...enabledDemoEnvironment, APP_BASE_URL: "" }
    }
  ])("rejects an enabled public demo with $name", ({ environment }) => {
    expect(() => resolvePublicDemoConfiguration(environment)).toThrow(/public demo|KINRESOLVE_PUBLIC_DEMO/i);
  });

  it.each(["TRUE", "1", "yes", "on"])("rejects the ambiguous enabled flag %s", (enabled) => {
    expect(() => resolvePublicDemoConfiguration({
      ...enabledDemoEnvironment,
      KINRESOLVE_PUBLIC_DEMO_ENABLED: enabled
    })).toThrow(/KINRESOLVE_PUBLIC_DEMO_ENABLED.*true or false/i);
  });
});
