import { describe, expect, it } from "vitest";

import {
  githubReleaseDraftOwnerMarker,
  validateGitHubReleaseNamespace
} from "@/lib/github-release-namespace";

const releaseCommit = "a".repeat(40);
const expectation = {
  repository: "kinresolve/kinresolve",
  releaseTag: "v0.18.0",
  releaseCommit,
  releaseVersion: "0.18.0",
  releaseMode: "api-launch" as const,
  workflowRunId: "987654321",
  remoteTagSha: releaseCommit
};

function release(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: expectation.releaseTag,
    target_commitish: expectation.releaseCommit,
    name: "Kin Resolve v0.18.0",
    id: 123456,
    body: `${githubReleaseDraftOwnerMarker(expectation)}\n\nGenerated notes`,
    draft: true,
    prerelease: false,
    assets: [],
    ...overrides
  };
}

describe("GitHub release namespace", () => {
  it("allows only a vacant namespace or the exact run-owned draft to be repaired", () => {
    expect(validateGitHubReleaseNamespace(
      [[]],
      { ...expectation, remoteTagSha: null },
      "repairable"
    )).toEqual({ state: "vacant", releaseDatabaseId: null });
    expect(validateGitHubReleaseNamespace([[release()]], expectation, "repairable"))
      .toEqual({ state: "draft", releaseDatabaseId: 123456 });
    expect(validateGitHubReleaseNamespace([[release()]], expectation, "draft"))
      .toEqual({ state: "draft", releaseDatabaseId: 123456 });
    expect(validateGitHubReleaseNamespace(
      [[release({ draft: false })]],
      expectation,
      "published"
    )).toEqual({ state: "published", releaseDatabaseId: 123456 });
  });

  it("rejects orphan tags, absent draft tags, and published reruns", () => {
    expect(() => validateGitHubReleaseNamespace([[]], expectation, "repairable"))
      .toThrow(/orphan candidate tag/i);
    expect(() => validateGitHubReleaseNamespace(
      [[release()]],
      { ...expectation, remoteTagSha: null },
      "repairable"
    )).toThrow(/tag is absent/i);
    expect(() => validateGitHubReleaseNamespace(
      [[release({ draft: false })]],
      expectation,
      "repairable"
    )).toThrow(/published release cannot be repaired/i);
  });

  it("allows an exact stable release only at the publication crash-recovery boundary", () => {
    expect(validateGitHubReleaseNamespace(
      [[release({ draft: false })]],
      expectation,
      "publication"
    )).toEqual({ state: "published", releaseDatabaseId: 123456 });
    expect(validateGitHubReleaseNamespace(
      [[]],
      { ...expectation, remoteTagSha: null },
      "publication"
    )).toEqual({ state: "vacant", releaseDatabaseId: null });
    expect(() => validateGitHubReleaseNamespace(
      [[release({ draft: false })]],
      expectation,
      "repairable"
    )).toThrow(/published release cannot be repaired/i);
  });

  it("rejects another run, malformed markers, and release binding drift", () => {
    for (const candidate of [
      release({ body: githubReleaseDraftOwnerMarker({ ...expectation, workflowRunId: "111" }) }),
      release({ body: `${githubReleaseDraftOwnerMarker(expectation)}\n${githubReleaseDraftOwnerMarker(expectation)}` }),
      release({ body: "<!-- kinresolve-release-draft-owner:broken -->" }),
      release({ target_commitish: "b".repeat(40) }),
      release({ name: "Kin Resolve v0.18.0 draft" }),
      release({ prerelease: true })
    ]) {
      expect(() => validateGitHubReleaseNamespace([[candidate]], expectation, "repairable"))
        .toThrow();
    }
  });

  it("binds ownership to repository, tag, commit, version, mode, and run ID", () => {
    const marker = githubReleaseDraftOwnerMarker(expectation);
    expect(marker).toContain("repository=kinresolve/kinresolve");
    expect(marker).toContain("tag=v0.18.0");
    expect(marker).toContain(`commit=${releaseCommit}`);
    expect(marker).toContain("version=0.18.0");
    expect(marker).toContain("mode=api-launch");
    expect(marker).toContain("run=987654321");
    expect(() => validateGitHubReleaseNamespace(
      [[release()]],
      { ...expectation, releaseMode: "application" },
      "repairable"
    )).toThrow(/owner marker/i);
  });

  it("rejects API launch markers or assets from an application-mode release", () => {
    const applicationExpectation = { ...expectation, releaseMode: "application" as const };
    const applicationMarker = githubReleaseDraftOwnerMarker(applicationExpectation);
    expect(() => validateGitHubReleaseNamespace(
      [[release({
        body: `${applicationMarker}\nkinresolve-api-launch-receipt:v1`,
        assets: []
      })]],
      applicationExpectation,
      "repairable"
    )).toThrow(/API launch marker/i);
    expect(() => validateGitHubReleaseNamespace(
      [[release({
        body: applicationMarker,
        assets: [{ name: "kinresolve-api-launch-receipt-run-1-attempt-1.json" }]
      })]],
      applicationExpectation,
      "repairable"
    )).toThrow(/API launch evidence/i);
  });

  it("rejects duplicate tag entries and malformed page listings", () => {
    expect(() => validateGitHubReleaseNamespace(
      [[release()], [release()]],
      expectation,
      "repairable"
    )).toThrow(/duplicate releases/i);
    expect(() => validateGitHubReleaseNamespace({}, expectation, "repairable"))
      .toThrow(/listing is invalid/i);
  });
});
