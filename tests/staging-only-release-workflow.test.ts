import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

let workflow = "";

beforeAll(async () => {
  workflow = await readFile(
    path.join(process.cwd(), ".github", "workflows", "vercel-release.yml"),
    "utf8"
  );
});

function job(name: string, nextName?: string): string {
  const start = workflow.indexOf(`\n  ${name}:`);
  const end = nextName ? workflow.indexOf(`\n  ${nextName}:`, start + 1) : workflow.length;
  expect(start, `missing ${name} job`).toBeGreaterThanOrEqual(0);
  expect(end, `missing ${nextName ?? "workflow end"}`).toBeGreaterThan(start);
  return workflow.slice(start, end);
}

function step(jobContents: string, name: string, nextName: string): string {
  const start = jobContents.indexOf(`\n      - name: ${name}`);
  const end = jobContents.indexOf(`\n      - name: ${nextName}`, start + 1);
  expect(start, `missing ${name} step`).toBeGreaterThanOrEqual(0);
  expect(end, `missing ${nextName} step`).toBeGreaterThan(start);
  return jobContents.slice(start, end);
}

describe("staging-only beta release workflow", () => {
  it("offers an explicit staging-only target while keeping production as the default", () => {
    const dispatch = workflow.slice(
      workflow.indexOf("  workflow_dispatch:"),
      workflow.indexOf("\npermissions:")
    );

    expect(dispatch).toMatch(
      /release_target:\n\s+description:.*\n\s+required: true\n\s+type: choice\n\s+default: production\n\s+options:\n\s+- staging-only\n\s+- production/
    );
    for (const input of [
      "recovery_run_id",
      "recovery_evidence_sha256",
      "writer_perimeter_acknowledgement"
    ]) {
      const start = dispatch.indexOf(`      ${input}:`);
      expect(start, `missing ${input} input`).toBeGreaterThanOrEqual(0);
      const inputBlock = dispatch.slice(start).match(
        new RegExp(`^      ${input}:[\\s\\S]*?(?=\\n      [a-z_]+:|$)`)
      )?.[0] ?? "";
      expect(inputBlock).toContain("required: false");
      expect(inputBlock).toContain('default: ""');
    }
  });

  it("fails closed on target-specific dispatch combinations before checkout", () => {
    const verify = job("verify", "staging");
    const validation = step(
      verify,
      "Validate dispatch request before checkout",
      "Check out the exact candidate revision"
    );

    expect(validation).toContain("RELEASE_TARGET: ${{ inputs.release_target }}");
    expect(validation).toContain('case "$RELEASE_TARGET" in');

    const targetCase = validation.slice(
      validation.indexOf('case "$RELEASE_TARGET" in'),
      validation.indexOf('case "$RELEASE_MODE" in')
    );
    const stagingOnly = targetCase.slice(
      targetCase.indexOf("staging-only)"),
      targetCase.indexOf("production)")
    );
    const production = targetCase.slice(
      targetCase.indexOf("production)"),
      targetCase.indexOf("*)", targetCase.indexOf("production)"))
    );

    expect(stagingOnly).toContain('test "$RELEASE_MODE" = "application"');
    expect(stagingOnly).toContain('test "$BETA_INTAKE_ENABLED" = "false"');
    expect(stagingOnly).toContain('test -z "$RECOVERY_RUN_ID"');
    expect(stagingOnly).toContain('test -z "$RECOVERY_EVIDENCE_SHA256"');
    expect(stagingOnly).toContain('test -z "$API_EDGE_RUN_ID"');
    expect(stagingOnly).toContain('test -z "$API_EDGE_EVIDENCE_SHA256"');
    expect(stagingOnly).toContain('test -z "$WRITER_PERIMETER_ACKNOWLEDGEMENT"');

    expect(production).toContain('[[ "$RECOVERY_RUN_ID" =~ ^[1-9][0-9]{0,19}$ ]]');
    expect(production).toContain('[[ "$RECOVERY_EVIDENCE_SHA256" =~ ^[0-9a-f]{64}$ ]]');
    expect(production).toContain('test "$WRITER_PERIMETER_ACKNOWLEDGEMENT" =');
    expect(validation).toContain('test "$AUTO_ASSIGNMENT_ACKNOWLEDGEMENT" =');
    expect(validation).toContain('test "$DEPLOYMENT_PROTECTION_ACKNOWLEDGEMENT" =');
    expect(validation).toContain('case "$RELEASE_MODE" in');
  });

  it("runs the staging path but explicitly skips every production-dependent job", () => {
    const verify = job("verify", "staging");
    const staging = job("staging", "staging-finalize");
    const finalizer = job("staging-finalize", "production");
    const production = job("production", "marketing");
    const marketing = job("marketing", "publish-release");
    const publication = job("publish-release");

    expect(verify.slice(0, verify.indexOf("\n    steps:"))).not.toContain("release_target");
    expect(staging.slice(0, staging.indexOf("\n    steps:"))).not.toContain("release_target");
    expect(finalizer.slice(0, finalizer.indexOf("\n    steps:"))).toContain(
      "if: ${{ always() && needs.staging.result != 'skipped' }}"
    );
    expect(production.slice(0, production.indexOf("\n    runs-on:"))).toContain(
      "if: ${{ inputs.release_target == 'production' }}"
    );
    expect(marketing.slice(0, marketing.indexOf("\n    runs-on:"))).toContain(
      "if: ${{ inputs.release_target == 'production' }}"
    );
    expect(publication.slice(0, publication.indexOf("\n    runs-on:"))).toContain(
      "if: ${{ inputs.release_target == 'production' }}"
    );
  });

  it("restores staging from protected finalizer inputs instead of secret-derived job outputs", () => {
    const finalizer = job("staging-finalize", "production");
    expect(finalizer).toContain("APPROVED_HOLDING_DEPLOYMENT_ID: ${{ secrets.STAGING_HOLDING_DEPLOYMENT_ID }}");
    expect(finalizer).toContain("APP_BASE_URL: ${{ vars.APP_BASE_URL }}");
    expect(finalizer).toContain("scripts/validate-vercel-deployment.mjs holding-record");
    expect(finalizer).not.toContain("needs.staging.outputs.holding_deployment_id");
    expect(finalizer).not.toContain("needs.staging.outputs.holding_deployment_url");
    expect(finalizer).not.toContain("needs.staging.outputs.app_base_url");
  });

  it("publishes required attempt-scoped machine evidence for the exact staging candidate", () => {
    const finalizer = job("staging-finalize", "production");
    const create = step(
      finalizer,
      "Create required staging-only candidate evidence",
      "Upload required staging-only candidate evidence"
    );
    const upload = step(
      finalizer,
      "Upload required staging-only candidate evidence",
      "Summarize successful staging-only candidate evidence"
    );
    const summary = step(
      finalizer,
      "Summarize successful staging-only candidate evidence",
      "Remove fresh-runner staging environment material"
    );

    expect(create).toContain("inputs.release_target == 'staging-only'");
    expect(create).toContain("STAGING_RESULT: ${{ needs.staging.result }}");
    expect(create).toContain('test "$STAGING_RESULT" = "success"');
    expect(create).toContain(
      "CANDIDATE_DEPLOYMENT_ID: ${{ needs.staging.outputs.candidate_deployment_id }}"
    );
    expect(create).toContain("RELEASE_RUN_ID: ${{ github.run_id }}");
    expect(create).toContain("RELEASE_RUN_ATTEMPT: ${{ github.run_attempt }}");
    expect(create).toContain("RELEASE_COMMIT: ${{ inputs.release_commit }}");
    expect(create).toContain("RELEASE_VERSION: ${{ inputs.release_version }}");
    expect(create).toContain("create-staging-demo-candidate-evidence.mjs");
    expect(upload).toContain("actions/upload-artifact@");
    expect(upload).toContain("staging-demo-candidate-evidence-${{ github.run_attempt }}");
    expect(upload).toContain("if-no-files-found: error");
    expect(upload).toContain("retention-days: 2");
    expect(summary).toContain('>> "$GITHUB_STEP_SUMMARY"');
  });
});
