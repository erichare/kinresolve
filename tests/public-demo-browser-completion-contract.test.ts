import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("public demo browser completion surfaces", () => {
  it("renders fixed safe fallback links after capacity or network rate rejection", () => {
    const form = source("components/demo-start-form.tsx");

    expect(form).toContain("familyUrl");
    expect(form).toContain("challengeUrl");
    expect(form).toContain('href="/family"');
    expect(form).toContain('href="/challenge"');
    expect(form).not.toMatch(/href=\{payload\.(?:familyUrl|challengeUrl)\}/);
  });

  it("runs protected operational health in both release proof and scheduled monitoring", () => {
    const release = source(".github/workflows/public-demo-release.yml");
    const monitoring = source(".github/workflows/public-demo-monitoring.yml");

    expect(release).toContain("KINRESOLVE_OBSERVABILITY_PROBE_SECRET");
    expect(monitoring).toContain("KINRESOLVE_OBSERVABILITY_PROBE_SECRET");
    expect(release).toContain("scripts/public-demo-internal-health-monitor.mjs");
    expect(monitoring).toContain("scripts/public-demo-internal-health-monitor.mjs");
  });
});
