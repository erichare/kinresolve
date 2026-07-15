import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function releaseWorkflow(): Promise<string> {
  return readFile(path.join(process.cwd(), ".github", "workflows", "vercel-release.yml"), "utf8");
}

function job(contents: string, name: "staging" | "production"): string {
  const start = contents.indexOf(`\n  ${name}:`);
  const next = contents.indexOf(name === "staging" ? "\n  production:" : "\n  publish-release:", start + 4);
  return contents.slice(start, next === -1 ? undefined : next);
}

function step(contents: string, name: string): string {
  const start = contents.indexOf(`- name: ${name}`);
  const next = contents.indexOf("\n      - name:", start + 1);
  return contents.slice(start, next === -1 ? undefined : next);
}

describe("runtime database role release gates", () => {
  it.each([
    ["staging", "Validate staging release contract", "Attest the staging runtime database role"],
    ["production", "Validate production release contract", "Attest the production runtime database role"]
  ] as const)("attests the pulled %s runtime before build, deploy, or mutation", async (name, contract, gate) => {
    const contents = job(await releaseWorkflow(), name);
    const contractPosition = contents.indexOf(contract);
    const gatePosition = contents.indexOf(gate);
    const buildPosition = contents.indexOf(name === "staging"
      ? "Build the staging production artifact"
      : "Build the production artifact before database mutation");
    const gateStep = step(contents, gate);

    expect(contractPosition).toBeGreaterThan(0);
    expect(gatePosition).toBeGreaterThan(contractPosition);
    expect(gatePosition).toBeLessThan(buildPosition);
    expect(gateStep).toContain("MIGRATION_DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}");
    expect(gateStep).toContain("npm run db:runtime-role:attest");
    expect(gateStep).toContain(".releaseFenceSelect == true");
    expect(gateStep).toContain(".releaseFenceReferences == false");
    expect(gateStep).toContain("(.bypassRls | type) == \"boolean\"");
    expect(gateStep).toContain(".representativeAppWriteRolledBack == true");
    expect(gateStep).toContain(".persistentMutation == false");
    expect(gateStep).not.toMatch(/(?:source|\.)\s+\.vercel\/\.env\.production\.local/);
    expect(gateStep).not.toMatch(/^\s*DATABASE_URL:/m);
  });

  it("binds readiness evidence to both protected Supabase project refs", async () => {
    const production = job(await releaseWorkflow(), "production");
    const readiness = step(production, "Download and verify attested recovery evidence");

    expect(readiness).toContain("SUPABASE_PROJECT_REF: ${{ vars.SUPABASE_PROJECT_REF }}");
    expect(readiness).toContain(
      "RECOVERY_TARGET_SUPABASE_PROJECT_REF: ${{ vars.RECOVERY_TARGET_SUPABASE_PROJECT_REF }}"
    );
  });

  it("uses direct protected database control for mutating fence transitions", async () => {
    const production = job(await releaseWorkflow(), "production");
    const release = step(production, "Release the attested production write fence");
    const contain = step(production, "Contain production writes before rollback");

    for (const [contents, operation] of [[release, "release"], [contain, "contain"]] as const) {
      expect(contents).toContain("RELEASE_FENCE_DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}");
      expect(contents).toContain(`npm run --silent release:fence:control -- ${operation}`);
      expect(contents).toContain(".fence.activationGeneration");
      expect(contents).not.toMatch(/FENCE_ORIGIN|RELEASE_FENCE_SECRET|VERCEL_AUTOMATION_BYPASS_SECRET/);
      expect(contents).not.toContain("/api/release/fence/");
    }
    expect(release).toContain('.transition == "released"');
    expect(release).not.toContain("already-released");
  });
});
