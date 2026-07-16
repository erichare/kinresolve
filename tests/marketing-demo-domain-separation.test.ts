import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  path.join(process.cwd(), ".github", "workflows", "site-deploy.yml"),
  "utf8"
);

function step(name: string): string {
  const start = workflow.indexOf(`      - name: ${name}`);
  const end = workflow.indexOf("\n      - name:", start + 1);
  expect(start, `missing step ${name}`).toBeGreaterThanOrEqual(0);
  return workflow.slice(start, end === -1 ? workflow.length : end);
}

describe("marketing deploy preserves dedicated public demo ownership", () => {
  it("proves project separation and domain ownership before loading marketing settings", () => {
    const pull = step("Pull Vercel project settings");

    expect(pull).toContain("DEMO_VERCEL_PROJECT_ID: ${{ vars.DEMO_VERCEL_PROJECT_ID }}");
    expect(pull).toContain('test "$DEMO_VERCEL_PROJECT_ID" != "$VERCEL_PROJECT_ID"');
    expect(pull).toContain(
      "https://api.vercel.com/v9/projects/$DEMO_VERCEL_PROJECT_ID/domains/$DEMO_DOMAIN"
    );
    expect(pull).toContain("scripts/validate-vercel-project-domain.mjs");
    expect(pull).toContain(
      "https://api.vercel.com/v9/projects/$VERCEL_PROJECT_ID/domains/$DEMO_DOMAIN"
    );
    expect(pull).toContain('test "$marketing_domain_status" = "404"');
    expect(pull.indexOf("validate-vercel-project-domain.mjs")).toBeLessThan(
      pull.indexOf("vercel pull")
    );
  });

  it("repeats the ownership proof after every production marketing deployment", () => {
    const deploy = step("Deploy production release");

    expect(deploy).toContain("DEMO_VERCEL_PROJECT_ID: ${{ vars.DEMO_VERCEL_PROJECT_ID }}");
    expect(deploy).toContain('test "$DEMO_VERCEL_PROJECT_ID" != "$VERCEL_PROJECT_ID"');
    expect(deploy).toContain("scripts/validate-vercel-project-domain.mjs");
    expect(deploy).toContain('test "$marketing_domain_status" = "404"');
    expect(deploy.indexOf("vercel deploy --prebuilt --prod --yes")).toBeLessThan(
      deploy.lastIndexOf("validate-vercel-project-domain.mjs")
    );
  });
});
