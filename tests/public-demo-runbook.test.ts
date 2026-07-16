import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("public demo operating runbook", () => {
  it("documents configuration, release rehearsal, containment, monitoring, and launch gates", () => {
    const runbook = read("docs/public-demo-runbook.md");

    for (const heading of [
      "Control-plane prerequisites",
      "Protected environment inventory",
      "First holding cutover",
      "Release procedure",
      "Rollback and containment",
      "Rehearsal sequence",
      "Monitoring and incident response",
      "External launch checklist"
    ]) {
      expect(runbook).toContain(`## ${heading}`);
    }
    for (const marker of [
      "kinresolve-demo",
      "DEMO_HOLDING_DEPLOYMENT_ID",
      "PRODUCT_CI_WORKFLOW_ID",
      "KINRESOLVE_STAGING_DEMO_WORKFLOW_ID",
      "PROMOTE KIN RESOLVE STATIC HOLDING TO DEMO.KINRESOLVE.COM",
      "demo-production",
      "demo-containment",
      "demo-monitoring",
      "holding -> candidate -> public -> rollback -> holding -> same-SHA re-promotion",
      "Five unfamiliar testers"
    ]) {
      expect(runbook).toContain(marker);
    }
  });

  it("retires the old traffic-session instructions and declares current domain intent", () => {
    const readme = read("README.md");
    const domains = read("docs/brand-and-domain.md");
    const holding = read("docs/static-holding-deployment.md");

    expect(readme).toContain("docs/public-demo-runbook.md");
    expect(readme).toContain("legacy staging demo controller is retired");
    expect(readme).not.toContain("may open\n`demo.kinresolve.com`");
    expect(domains).toContain("Always-on isolated synthetic public demo");
    expect(domains).toContain("Primary call to action:** Try Kin Resolve");
    expect(holding).toContain("`public-demo`");
    expect(holding).toContain("DEMO_HOLDING_DEPLOYMENT_ID=dpl_");
  });
});
