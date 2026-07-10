import { afterEach, describe, expect, it, vi } from "vitest";

import { getDatabasePoolMax, isDatabaseAutoMigrateEnabled } from "@/lib/db";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("database runtime configuration", () => {
  it("uses a positive configured pool limit", () => {
    vi.stubEnv("DATABASE_POOL_MAX", "4");

    expect(getDatabasePoolMax()).toBe(4);
  });

  it("uses the serverless-safe default outside development", () => {
    vi.stubEnv("DATABASE_POOL_MAX", "not-a-number");
    vi.stubEnv("NODE_ENV", "production");

    expect(getDatabasePoolMax()).toBe(2);
  });

  it("keeps schema bootstrap enabled unless explicitly disabled", () => {
    vi.stubEnv("DATABASE_AUTO_MIGRATE", "true");
    expect(isDatabaseAutoMigrateEnabled()).toBe(true);

    vi.stubEnv("DATABASE_AUTO_MIGRATE", "false");
    expect(isDatabaseAutoMigrateEnabled()).toBe(false);
  });
});
