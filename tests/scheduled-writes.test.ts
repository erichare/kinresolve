import { describe, expect, it } from "vitest";

import {
  getScheduledWritesStatus,
  resolveScheduledWritesConfiguration
} from "@/lib/scheduled-writes";

describe("scheduled-write configuration", () => {
  it("preserves enabled scheduled work by default for self-hosted deployments", () => {
    expect(resolveScheduledWritesConfiguration({
      KINRESOLVE_DEPLOYMENT_MODE: "self-hosted"
    })).toEqual({ configured: false, enabled: true });
  });

  it.each([
    ["true", true],
    ["false", false]
  ] as const)("accepts an explicit exact %s value", (value, enabled) => {
    expect(resolveScheduledWritesConfiguration({
      KINRESOLVE_DEPLOYMENT_MODE: "hosted",
      KINRESOLVE_DATASET_MODE: "pilot",
      KINRESOLVE_SCHEDULED_WRITES_ENABLED: value
    })).toEqual({ configured: true, enabled });
  });

  it("requires a valid explicit value for hosted deployments", () => {
    expect(() => resolveScheduledWritesConfiguration({
      KINRESOLVE_DEPLOYMENT_MODE: "hosted",
      KINRESOLVE_DATASET_MODE: "pilot"
    })).toThrow(/KINRESOLVE_SCHEDULED_WRITES_ENABLED.*required.*hosted/i);

    expect(() => resolveScheduledWritesConfiguration({
      KINRESOLVE_DEPLOYMENT_MODE: "hosted",
      KINRESOLVE_DATASET_MODE: "pilot",
      KINRESOLVE_SCHEDULED_WRITES_ENABLED: "yes"
    })).toThrow(/KINRESOLVE_SCHEDULED_WRITES_ENABLED.*true or false/i);
  });

  it("projects invalid hosted configuration as disabled without exposing its value", () => {
    expect(getScheduledWritesStatus({
      KINRESOLVE_DEPLOYMENT_MODE: "hosted",
      KINRESOLVE_DATASET_MODE: "pilot"
    })).toEqual({ valid: false, configured: false, enabled: false });

    expect(getScheduledWritesStatus({
      KINRESOLVE_DEPLOYMENT_MODE: "hosted",
      KINRESOLVE_DATASET_MODE: "pilot",
      KINRESOLVE_SCHEDULED_WRITES_ENABLED: "secret-invalid-marker"
    })).toEqual({ valid: false, configured: true, enabled: false });
  });
});
