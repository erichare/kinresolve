import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("stable release migration history", () => {
  it("checks out full history so immutable release anchors can be verified", async () => {
    const workflow = await readFile(path.join(process.cwd(), ".github", "workflows", "vercel-release.yml"), "utf8");

    expect(workflow).toMatch(/fetch-depth:\s*0/);
    expect(workflow).toContain("npm run migrations:verify");
    const productionStart = workflow.indexOf("\n  production:");
    const productionEnd = workflow.indexOf("\n  publish-release:", productionStart);
    const production = workflow.slice(productionStart, productionEnd);
    expect(production.indexOf("scripts/validate-release-policy.mjs")).toBeLessThan(
      production.indexOf("npm run db:migrate:production")
    );
    expect(production.indexOf("npm run db:migrate:production")).toBeLessThan(
      production.indexOf("npm run db:migrations:verify-production")
    );
  });
});
