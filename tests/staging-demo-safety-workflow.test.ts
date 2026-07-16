import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("staging demo automatic safety workflow", () => {
  it("binds only exact failed session attempts before loading containment credentials", async () => {
    const contents = await readFile(
      path.join(process.cwd(), ".github", "workflows", "staging-demo-safety.yml"),
      "utf8"
    );
    expect(contents).toContain("- Operate Kin Resolve synthetic staging demo session");
    expect(contents).toContain("github.event.workflow_run.conclusion == 'failure'");
    expect(contents).toContain("github.event.workflow_run.conclusion == 'cancelled'");
    expect(contents).toContain("github.event.workflow_run.conclusion == 'timed_out'");
    expect(contents).toContain('test "$SOURCE_WORKFLOW_PATH" = ".github/workflows/staging-demo-session.yml"');
    expect(contents).toContain('test "$SOURCE_EVENT" = "workflow_dispatch"');
    expect(contents).toContain('test "$SOURCE_HEAD_BRANCH" = "main"');
    expect(contents).toContain("group: kinresolve-beta-staging-demo-safety");
    expect(contents).not.toContain("group: kinresolve-beta-release\n");
    expect(contents).toContain("environment: beta-staging-containment");
    const authorize = contents.slice(contents.indexOf("  authorize:"), contents.indexOf("  close:"));
    expect(authorize).not.toMatch(/^    environment:/m);
  });

  it("restores the pinned holding or independently proves staging paused", async () => {
    const contents = await readFile(
      path.join(process.cwd(), ".github", "workflows", "staging-demo-safety.yml"),
      "utf8"
    );
    expect(contents).toContain("scripts/validate-vercel-deployment.mjs holding-record");
    const holdingRecord = contents.slice(
      contents.indexOf("- name: Fetch and validate the pinned staging holding record"),
      contents.indexOf("- name: Restore the pinned staging holding deployment")
    );
    expect(holdingRecord).toContain("continue-on-error: true");
    expect(contents).toContain('vercel promote "$HOLDING_DEPLOYMENT_URL" --yes --timeout=5m');
    expect(contents).toContain("scripts/validate-vercel-deployment.mjs holding");
    expect(contents).toContain("scripts/validate-vercel-project-safety.mjs");
    expect(contents).toContain('test "$APP_BASE_URL" = "https://demo.kinresolve.com"');
    expect(contents).toContain("https://api.vercel.com/v1/projects/$VERCEL_PROJECT_ID/pause");
    expect(contents).toContain("Record the exact demo safety receipt");
  });
});
