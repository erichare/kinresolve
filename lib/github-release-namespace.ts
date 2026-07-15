const commitPattern = /^[a-f0-9]{40}$/;
const positiveIntegerPattern = /^[1-9][0-9]{0,19}$/;
const repositoryPattern = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const tagPattern = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const ownerMarkerPattern = /<!-- kinresolve-release-draft-owner:v1 [^\r\n<>]* -->/g;

export type GitHubReleaseNamespaceExpectation = Readonly<{
  repository: string;
  releaseTag: string;
  releaseCommit: string;
  releaseVersion: string;
  releaseMode: "application" | "api-launch";
  workflowRunId: string;
  remoteTagSha: string | null;
}>;

export type GitHubReleaseNamespaceState = "vacant" | "draft" | "published";

type GitHubRelease = Readonly<{
  id: number;
  tag_name: string;
  target_commitish: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  assets: ReadonlyArray<{ name: string }>;
}>;

type GitHubReleaseOwnerBinding = Omit<GitHubReleaseNamespaceExpectation, "remoteTagSha">;

export function githubReleaseDraftOwnerMarker(input: GitHubReleaseOwnerBinding): string {
  const binding = validateOwnerBinding(input);
  return `<!-- kinresolve-release-draft-owner:v1 repository=${binding.repository} tag=${binding.releaseTag} commit=${binding.releaseCommit} version=${binding.releaseVersion} mode=${binding.releaseMode} run=${binding.workflowRunId} -->`;
}

export function validateGitHubReleaseNamespace(
  value: unknown,
  expectationInput: GitHubReleaseNamespaceExpectation,
  requiredState: "repairable" | "publication" | "draft" | "published"
): Readonly<{ state: GitHubReleaseNamespaceState; releaseDatabaseId: number | null }> {
  const expectation = validateExpectation(expectationInput);
  const releases = flattenReleasePages(value).map((release) => object(release, "GitHub release"));
  const matches = releases.filter((release) => release.tag_name === expectation.releaseTag);
  if (matches.length > 1) {
    throw new Error("The release namespace contains duplicate releases for the candidate tag.");
  }

  if (matches.length === 0) {
    if (requiredState !== "repairable" && requiredState !== "publication") {
      throw new Error(`The required ${requiredState} release does not exist.`);
    }
    if (expectation.remoteTagSha !== null) {
      throw new Error("The release namespace contains an orphan candidate tag.");
    }
    return { state: "vacant", releaseDatabaseId: null };
  }

  const release = validateRelease(matches[0], expectation);
  if (expectation.remoteTagSha !== expectation.releaseCommit) {
    throw new Error("The candidate tag is absent or does not resolve to the release commit.");
  }

  const state: GitHubReleaseNamespaceState = release.draft ? "draft" : "published";
  if (requiredState === "publication") {
    return { state, releaseDatabaseId: release.id };
  }
  if (requiredState === "repairable") {
    if (state !== "draft") {
      throw new Error("A published release cannot be repaired by this workflow run.");
    }
    return { state, releaseDatabaseId: release.id };
  }
  if (state !== requiredState) {
    throw new Error(`The release namespace is ${state}, not ${requiredState}.`);
  }
  return { state, releaseDatabaseId: release.id };
}

function validateExpectation(
  input: GitHubReleaseNamespaceExpectation
): GitHubReleaseNamespaceExpectation {
  validateOwnerBinding(input);
  if (input.remoteTagSha !== null && !commitPattern.test(input.remoteTagSha)) {
    throw new Error("The remote tag commit is invalid.");
  }
  return input;
}

function validateOwnerBinding<T extends GitHubReleaseOwnerBinding>(input: T): T {
  if (!repositoryPattern.test(input.repository)) throw new Error("The release repository is invalid.");
  if (!tagPattern.test(input.releaseTag)) throw new Error("The release tag is invalid.");
  if (!commitPattern.test(input.releaseCommit)) throw new Error("The release commit is invalid.");
  if (!versionPattern.test(input.releaseVersion)) throw new Error("The release version is invalid.");
  if (input.releaseTag !== `v${input.releaseVersion}`) {
    throw new Error("The release tag and version do not match.");
  }
  if (input.releaseMode !== "application" && input.releaseMode !== "api-launch") {
    throw new Error("The release mode is invalid.");
  }
  if (!positiveIntegerPattern.test(input.workflowRunId)) {
    throw new Error("The release workflow run ID is invalid.");
  }
  return input;
}

function flattenReleasePages(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("The GitHub release listing is invalid.");
  const pages = value.length > 0 && value.every(Array.isArray) ? value : [value];
  const releases = pages.flat();
  if (releases.length > 10_000) throw new Error("The GitHub release listing is too large.");
  return releases;
}

function validateRelease(
  value: unknown,
  expectation: GitHubReleaseNamespaceExpectation
): GitHubRelease {
  const release = object(value, "GitHub release");
  const expectedTitle = `Kin Resolve v${expectation.releaseVersion}`;
  if (
    typeof release.id !== "number"
    || !Number.isSafeInteger(release.id)
    || release.id <= 0
    || release.tag_name !== expectation.releaseTag
    || release.target_commitish !== expectation.releaseCommit
    || release.name !== expectedTitle
    || typeof release.body !== "string"
    || typeof release.draft !== "boolean"
    || release.prerelease !== false
    || !Array.isArray(release.assets)
  ) {
    throw new Error("The GitHub release binding is invalid.");
  }

  const expectedMarker = githubReleaseDraftOwnerMarker(expectation);
  const markers = [...release.body.matchAll(ownerMarkerPattern)].map((match) => match[0]);
  const sentinelCount = release.body.split("kinresolve-release-draft-owner:").length - 1;
  if (sentinelCount !== 1 || markers.length !== 1 || markers[0] !== expectedMarker) {
    throw new Error("The GitHub release draft owner marker is invalid.");
  }
  for (const asset of release.assets) {
    const candidate = object(asset, "GitHub release asset");
    if (typeof candidate.name !== "string") throw new Error("A GitHub release asset is invalid.");
    if (
      expectation.releaseMode === "application"
      && candidate.name.includes("kinresolve-api-launch-receipt")
    ) {
      throw new Error("An application release contains API launch evidence.");
    }
  }
  if (
    expectation.releaseMode === "application"
    && release.body.includes("kinresolve-api-launch-receipt:")
  ) {
    throw new Error("An application release contains an API launch marker.");
  }
  return release as unknown as GitHubRelease;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}
