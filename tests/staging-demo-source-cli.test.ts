import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scratch: string[] = [];
const sha = "0123456789abcdef0123456789abcdef01234567";

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe("staging demo source CLI", () => {
  it("creates one mode-0600 attempt-bound candidate evidence document", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "kinresolve-demo-evidence-"));
    scratch.push(directory);
    const evidencePath = path.join(directory, "staging-demo-candidate-evidence.json");
    const result = spawnSync(process.execPath, [
      "--no-warnings",
      "--experimental-strip-types",
      "scripts/create-staging-demo-candidate-evidence.mjs",
      evidencePath
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "erichare/kinresolve",
        RELEASE_RUN_ID: "29470000001",
        RELEASE_RUN_ATTEMPT: "1",
        RELEASE_COMMIT: sha,
        RELEASE_VERSION: "0.18.0",
        CANDIDATE_DEPLOYMENT_ID: "dpl_StagingCandidate123456789"
      }
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(await readFile(evidencePath, "utf8"))).toEqual({
      schemaVersion: 1,
      kind: "kinresolve-staging-demo-candidate-v1",
      repository: "erichare/kinresolve",
      workflowPath: ".github/workflows/vercel-release.yml",
      runId: "29470000001",
      runAttempt: "1",
      headSha: sha,
      releaseVersion: "0.18.0",
      candidateDeploymentId: "dpl_StagingCandidate123456789"
    });
    expect((await stat(evidencePath)).mode & 0o777).toBe(0o600);
  });

  it("validates nonsecret GitHub run and job documents without echoing them", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "kinresolve-demo-source-"));
    scratch.push(directory);
    const runPath = path.join(directory, "run.json");
    const jobsPath = path.join(directory, "jobs.json");
    const evidencePath = path.join(directory, "staging-demo-candidate-evidence.json");
    const run = {
      id: 29470000001,
      run_attempt: 1,
      status: "completed",
      conclusion: "success",
      event: "workflow_dispatch",
      head_branch: "main",
      head_sha: sha,
      path: ".github/workflows/vercel-release.yml",
      name: "Release Kin Resolve beta candidate",
      display_title: "Kin Resolve beta release run 29470000001 attempt 1",
      repository: { full_name: "erichare/kinresolve" },
      head_repository: { full_name: "erichare/kinresolve" },
      created_at: new Date().toISOString()
    };
    const names = [
      ["Require prior automatic safety work to finish", "success"],
      ["verify", "success"],
      ["staging", "success"],
      ["Restore staging holding alias and synthetic baseline", "success"],
      ["Deploy and promote production candidate", "skipped"],
      ["Publish the evidence-bound marketing intake mode", "skipped"],
      ["Publish stable GitHub release", "skipped"]
    ];
    const jobs = {
      total_count: names.length,
      jobs: names.map(([name, conclusion]) => ({ name, status: "completed", conclusion }))
    };
    const evidence = {
      schemaVersion: 1,
      kind: "kinresolve-staging-demo-candidate-v1",
      repository: "erichare/kinresolve",
      workflowPath: ".github/workflows/vercel-release.yml",
      runId: "29470000001",
      runAttempt: "1",
      headSha: sha,
      releaseVersion: "0.18.0",
      candidateDeploymentId: "dpl_StagingCandidate123456789"
    };
    await Promise.all([
      writeFile(runPath, JSON.stringify(run), "utf8"),
      writeFile(jobsPath, JSON.stringify(jobs), "utf8"),
      writeFile(evidencePath, JSON.stringify(evidence), "utf8")
    ]);

    const result = spawnSync(process.execPath, [
      "--no-warnings",
      "--experimental-strip-types",
      "scripts/validate-staging-demo-source.mjs",
      runPath,
      jobsPath,
      evidencePath
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "erichare/kinresolve",
        SOURCE_RELEASE_RUN_ID: "29470000001",
        SOURCE_RELEASE_RUN_ATTEMPT: "1",
        SESSION_COMMIT: sha
      }
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("source_release_run_id=29470000001\n");
    expect(result.stdout).toContain(`source_release_sha=${sha}\n`);
    expect(result.stdout).toContain("release_version=0.18.0\n");
    expect(result.stdout).toContain(
      "candidate_deployment_id=dpl_StagingCandidate123456789\n"
    );
    expect(result.stdout).not.toContain("repository");
  });
});
