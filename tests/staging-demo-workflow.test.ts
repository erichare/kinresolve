import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

async function workflow() {
  return readFile(
    path.join(process.cwd(), ".github", "workflows", "staging-demo-session.yml"),
    "utf8"
  );
}

describe("retired staging demo session workflow", () => {
  it("preserves historical run identity as a credential-free tombstone", async () => {
    const contents = await workflow();

    expect(contents).toContain("name: Operate Kin Resolve synthetic staging demo session");
    expect(contents).toContain(
      "run-name: Kin Resolve staging demo ${{ inputs.action }} run ${{ github.run_id }} attempt ${{ github.run_attempt }}"
    );
    expect(contents).toMatch(/^on:\s*\n\s*workflow_dispatch:/m);
    expect(contents).toMatch(/action:[\s\S]*?type: choice[\s\S]*?options:[\s\S]*?- open[\s\S]*?- close/);
    expect(contents).toContain("This legacy staging demo workflow is retired");
    expect(contents).toContain("group: kinresolve-public-demo-release");
    expect(contents).toContain("cancel-in-progress: false");
  });

  it("cannot load a protected environment or mutate any Vercel hostname", async () => {
    const contents = await workflow();

    expect(contents).not.toMatch(/^\s+environment:/m);
    expect(contents).not.toContain("secrets.");
    expect(contents).not.toContain("VERCEL_TOKEN");
    expect(contents).not.toContain("demo.kinresolve.com");
    expect(contents).not.toContain("vercel promote");
    expect(contents).not.toMatch(/\/pause|\/unpause/);
    expect(contents).not.toContain("DATABASE_URL");
    expect(contents).not.toContain("MIGRATION_DATABASE_URL");
  });
});
