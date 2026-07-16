import { describe, expect, it } from "vitest";

import { validateStagingDemoSourceRun } from "@/lib/staging-demo-source";

const sha = "0123456789abcdef0123456789abcdef01234567";
const now = new Date("2026-07-16T02:00:00.000Z");

function sourceRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 29470000001,
    run_attempt: 2,
    status: "completed",
    conclusion: "success",
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: sha,
    path: ".github/workflows/vercel-release.yml",
    name: "Release Kin Resolve beta candidate",
    display_title: "Kin Resolve beta release run 29470000001 attempt 2",
    repository: { full_name: "erichare/kinresolve" },
    head_repository: { full_name: "erichare/kinresolve" },
    created_at: "2026-07-16T01:00:00.000Z",
    ...overrides
  };
}

function job(name: string, conclusion: string) {
  return { name, status: "completed", conclusion };
}

function jobs(overrides: Record<string, unknown>[] = []) {
  const values = [
    job("Require prior automatic safety work to finish", "success"),
    job("verify", "success"),
    job("staging", "success"),
    job("Restore staging holding alias and synthetic baseline", "success"),
    job("Deploy and promote production candidate", "skipped"),
    job("Publish the evidence-bound marketing intake mode", "skipped"),
    job("Publish stable GitHub release", "skipped"),
    ...overrides
  ];
  return { total_count: values.length, jobs: values };
}

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    kind: "kinresolve-staging-demo-candidate-v1",
    repository: "erichare/kinresolve",
    workflowPath: ".github/workflows/vercel-release.yml",
    runId: "29470000001",
    runAttempt: "2",
    headSha: sha,
    releaseVersion: "0.18.0",
    candidateDeploymentId: "dpl_StagingCandidate123456789",
    ...overrides
  };
}

const expectations = {
  expectedRepository: "erichare/kinresolve",
  expectedRunId: "29470000001",
  expectedRunAttempt: "2",
  expectedHeadSha: sha,
  now,
  maximumAgeMs: 24 * 60 * 60 * 1000
};

describe("staging demo source attestation", () => {
  it("accepts a fresh successful staging-only release attempt from exact current main", () => {
    expect(validateStagingDemoSourceRun(sourceRun(), jobs(), evidence(), expectations)).toEqual({
      runId: "29470000001",
      runAttempt: "2",
      headSha: sha,
      createdAt: "2026-07-16T01:00:00.000Z",
      releaseVersion: "0.18.0",
      candidateDeploymentId: "dpl_StagingCandidate123456789"
    });
  });

  it.each([
    ["workflow", { path: ".github/workflows/other.yml" }],
    ["repository", { repository: { full_name: "fork/kinresolve" } }],
    ["head repository", { head_repository: { full_name: "fork/kinresolve" } }],
    ["branch", { head_branch: "feature" }],
    ["SHA", { head_sha: "f".repeat(40) }],
    ["run ID", { id: 29470000002 }],
    ["attempt", { run_attempt: 1 }],
    ["event", { event: "push" }],
    ["conclusion", { conclusion: "failure" }]
  ])("rejects the wrong %s provenance", (_label, override) => {
    expect(() => validateStagingDemoSourceRun(sourceRun(override), jobs(), evidence(), expectations))
      .toThrow(/source|release|run|provenance/i);
  });

  it("rejects stale or future-dated release attempts", () => {
    expect(() => validateStagingDemoSourceRun(sourceRun({
      created_at: "2026-07-15T01:59:59.999Z"
    }), jobs(), evidence(), expectations)).toThrow(/fresh|old/i);
    expect(() => validateStagingDemoSourceRun(sourceRun({
      created_at: "2026-07-16T02:05:00.001Z"
    }), jobs(), evidence(), expectations)).toThrow(/future|time/i);
  });

  it.each([
    ["verify", "failure"],
    ["staging", "failure"],
    ["Restore staging holding alias and synthetic baseline", "failure"],
    ["Deploy and promote production candidate", "success"],
    ["Publish the evidence-bound marketing intake mode", "success"],
    ["Publish stable GitHub release", "success"]
  ])("rejects an invalid %s job conclusion", (name, conclusion) => {
    const document = jobs().jobs.map((value) => value.name === name
      ? job(name, conclusion)
      : value);
    expect(() => validateStagingDemoSourceRun(sourceRun(), {
      total_count: document.length,
      jobs: document
    }, evidence(), expectations)).toThrow(/job|staging-only/i);
  });

  it("fails closed for duplicate, incomplete, or truncated job evidence", () => {
    expect(() => validateStagingDemoSourceRun(sourceRun(), jobs([
      job("staging", "success")
    ]), evidence(), expectations)).toThrow(/duplicate|job/i);
    expect(() => validateStagingDemoSourceRun(sourceRun(), {
      ...jobs(),
      total_count: 99
    }, evidence(), expectations)).toThrow(/incomplete|malformed/i);
    expect(() => validateStagingDemoSourceRun(sourceRun(), {
      total_count: 0,
      jobs: []
    }, evidence(), expectations)).toThrow(/job/i);
  });

  it("rejects unexpected jobs instead of silently expanding the staging-only boundary", () => {
    expect(() => validateStagingDemoSourceRun(
      sourceRun(),
      jobs([job("New production side effect", "success")]),
      evidence(),
      expectations
    )).toThrow(/unexpected|job|complete/i);
  });

  it.each([
    ["repository", { repository: "fork/kinresolve" }],
    ["workflow", { workflowPath: ".github/workflows/other.yml" }],
    ["run", { runId: "29470000002" }],
    ["attempt", { runAttempt: "1" }],
    ["SHA", { headSha: "f".repeat(40) }],
    ["version", { releaseVersion: "latest" }],
    ["candidate", { candidateDeploymentId: "dpl_other" }]
  ])("rejects candidate evidence with the wrong %s binding", (_label, override) => {
    expect(() => validateStagingDemoSourceRun(
      sourceRun(), jobs(), evidence(override), expectations
    )).toThrow(/evidence|candidate|source|release/i);
  });
});
