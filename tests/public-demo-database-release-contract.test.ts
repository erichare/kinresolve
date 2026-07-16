import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  path.join(process.cwd(), ".github", "workflows", "public-demo-release.yml"),
  "utf8"
);

function workflowStep(name: string): { contents: string; start: number } {
  const marker = `- name: ${name}`;
  const start = workflow.indexOf(marker);
  expect(start, `missing workflow step: ${name}`).toBeGreaterThan(-1);
  const end = workflow.indexOf("\n      - name:", start + marker.length);
  return {
    contents: workflow.slice(start, end === -1 ? workflow.length : end),
    start
  };
}

describe("public demo database release contract", () => {
  it("attests the migration credential's exact database identity before any mutation", () => {
    const identity = workflowStep(
      "Attest the exact demo migration database before mutation"
    );
    const migration = workflowStep("Migrate and provision only the isolated demo database");

    expect(identity.start).toBeLessThan(migration.start);
    expect(identity.contents).toContain(
      "DATABASE_IDENTITY_URL: ${{ secrets.MIGRATION_DATABASE_URL }}"
    );
    expect(identity.contents).toContain(
      "EXPECTED_DATABASE_IDENTITY: ${{ vars.KINRESOLVE_DATABASE_IDENTITY }}"
    );
    expect(identity.contents).toContain(
      'actual_database_identity="$(npm run --silent db:identity)"'
    );
    expect(identity.contents).toContain(
      '[[ "$actual_database_identity" =~ ^[a-f0-9]{64}$ ]]'
    );
    expect(identity.contents).toContain(
      'test "$actual_database_identity" = "$EXPECTED_DATABASE_IDENTITY"'
    );
    expect(identity.contents).not.toMatch(/^\s*DATABASE_URL:/m);

    const firstDatabaseMutation = Math.min(
      workflow.indexOf("npm run db:migrate"),
      workflow.indexOf("npm run archive:provision")
    );
    expect(firstDatabaseMutation).toBeGreaterThan(identity.start);
  });

  it("verifies the exact migration ledger and canonical archive before grants or deployment", () => {
    const migration = workflowStep("Migrate and provision only the isolated demo database");
    const verification = workflowStep(
      "Verify the exact demo migration ledger and canonical archive"
    );
    const runtimeGrant = workflowStep("Grant and re-attest public demo runtime access");
    const deployment = workflowStep("Deploy the unaliased public demo candidate");

    expect(verification.start).toBeGreaterThan(migration.start);
    expect(verification.start).toBeLessThan(runtimeGrant.start);
    expect(verification.start).toBeLessThan(deployment.start);
    expect(verification.contents).toContain(
      "MIGRATION_DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}"
    );
    expect(verification.contents).toContain(
      "KINRESOLVE_DATABASE_IDENTITY: ${{ vars.KINRESOLVE_DATABASE_IDENTITY }}"
    );
    expect(verification.contents).toContain("EXPECTED_ARCHIVE_ID: kinresolve-demo-public");
    expect(verification.contents).toContain("npm run db:migrations:verify-production");
    expect(verification.contents).not.toMatch(/^\s*DATABASE_URL:/m);
  });
});
