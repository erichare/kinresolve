import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isAuthorizedPublicDemoCanary } from "@/lib/public-demo-canary";

describe("public demo canary attribution", () => {
  it("recognizes only the exact server-owned canary credential", () => {
    const secret = "c".repeat(43);
    const environment = { KINRESOLVE_DEMO_CANARY_SECRET: secret };

    expect(isAuthorizedPublicDemoCanary(new Headers({
      "x-kinresolve-demo-canary": secret
    }), environment)).toBe(true);
    expect(isAuthorizedPublicDemoCanary(new Headers({
      "x-kinresolve-demo-canary": `${secret.slice(0, -1)}x`
    }), environment)).toBe(false);
    expect(isAuthorizedPublicDemoCanary(new Headers(), environment)).toBe(false);
    expect(isAuthorizedPublicDemoCanary(new Headers({
      "x-kinresolve-demo-canary": secret
    }), {})).toBe(false);
  });

  it("marks canary sessions server-side and suppresses their funnel events", async () => {
    const migration = await source("db/migrations/018_public_demo.sql");
    const route = await source("app/api/demo/sessions/route.ts");
    const store = await source("lib/public-demo-session-store.ts");

    expect(migration).toMatch(/public_demo_sessions[\s\S]*is_canary boolean NOT NULL DEFAULT false/);
    expect(route).toContain("isAuthorizedPublicDemoCanary");
    expect(route).toContain("isCanary:");
    expect(store).toMatch(/recordPublicDemoEvent[\s\S]*is_canary = false/);
  });
});

function source(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}
