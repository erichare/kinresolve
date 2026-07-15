import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getDatabaseConnectionString,
  getDatabasePoolMax,
  isDatabaseAutoMigrateEnabled,
  isDatabaseTransportVerified
} from "@/lib/db";

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

  it("verifies Supabase pooler certificates with the bundled root CA", () => {
    const connectionString = getDatabaseConnectionString(
      "postgresql://postgres.example:p%40ssword@aws-0-us-west-1.pooler.supabase.com:6543/postgres?sslmode=require&sslrootcert=%2Ftmp%2Fwrong.crt&uselibpqcompat=true&application_name=kinsleuth"
    );
    const parsed = new URL(connectionString);

    expect(parsed.hostname).toBe("aws-0-us-west-1.pooler.supabase.com");
    expect(parsed.port).toBe("6543");
    expect(decodeURIComponent(parsed.username)).toBe("postgres.example");
    expect(decodeURIComponent(parsed.password)).toBe("p@ssword");
    expect(parsed.searchParams.get("sslmode")).toBe("verify-full");
    expect(parsed.searchParams.get("uselibpqcompat")).toBeNull();
    expect(parsed.searchParams.get("application_name")).toBe("kinsleuth");
    expect(parsed.searchParams.get("sslrootcert")).toBe(
      path.join(process.cwd(), "certs", "supabase-prod-ca-2021.crt")
    );
  });

  it("also verifies Supabase direct connections and exposes the effective transport status", () => {
    const source =
      "postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?sslmode=disable";
    const parsed = new URL(getDatabaseConnectionString(source));

    expect(parsed.searchParams.get("sslmode")).toBe("verify-full");
    expect(parsed.searchParams.get("sslrootcert")).toBe(
      path.join(process.cwd(), "certs", "supabase-prod-ca-2021.crt")
    );
    expect(isDatabaseTransportVerified(source)).toBe(true);
    expect(isDatabaseTransportVerified("postgresql://app@db.example.com/postgres?sslmode=require")).toBe(false);
  });

  it("leaves non-Supabase database URLs unchanged", () => {
    const connectionString = "postgres://kinsleuth:kinsleuth@localhost:5432/kinsleuth";

    expect(getDatabaseConnectionString(connectionString)).toBe(connectionString);
  });
});
