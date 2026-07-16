type JsonObject = Record<string, unknown>;

export type StagingDemoSourceExpectations = {
  expectedRepository: string;
  expectedRunId: string;
  expectedRunAttempt: string;
  expectedHeadSha: string;
  now?: Date;
  maximumAgeMs?: number;
};

export type ValidatedStagingDemoSource = {
  runId: string;
  runAttempt: string;
  headSha: string;
  createdAt: string;
  releaseVersion: string;
  candidateDeploymentId: string;
};

export type StagingDemoCandidateEvidence = Readonly<{
  schemaVersion: 1;
  kind: "kinresolve-staging-demo-candidate-v1";
  repository: string;
  workflowPath: ".github/workflows/vercel-release.yml";
  runId: string;
  runAttempt: string;
  headSha: string;
  releaseVersion: string;
  candidateDeploymentId: string;
}>;

export type CreateStagingDemoCandidateEvidenceInput = {
  repository: string;
  runId: string;
  runAttempt: string;
  headSha: string;
  releaseVersion: string;
  candidateDeploymentId: string;
};

const workflowName = "Release Kin Resolve beta candidate";
const workflowPath = ".github/workflows/vercel-release.yml";
const futureClockToleranceMs = 5 * 60 * 1000;
const defaultMaximumAgeMs = 24 * 60 * 60 * 1000;

const requiredJobConclusions = new Map([
  ["Require prior automatic safety work to finish", "success"],
  ["verify", "success"],
  ["staging", "success"],
  ["Restore staging holding alias and synthetic baseline", "success"],
  ["Deploy and promote production candidate", "skipped"],
  ["Publish the evidence-bound marketing intake mode", "skipped"],
  ["Publish stable GitHub release", "skipped"]
]);

export function validateStagingDemoSourceRun(
  runDocument: unknown,
  jobsDocument: unknown,
  evidenceDocument: unknown,
  expectations: StagingDemoSourceExpectations
): ValidatedStagingDemoSource {
  const run = object(runDocument, "The source release run");
  const expectedRepository = repository(expectations.expectedRepository);
  const expectedRunId = integer(expectations.expectedRunId, "The expected source run ID", 20);
  const expectedRunAttempt = integer(
    expectations.expectedRunAttempt,
    "The expected source run attempt",
    10
  );
  const expectedHeadSha = sha(expectations.expectedHeadSha, "The expected source head SHA");
  const actualRunId = integer(run.id, "The source release run ID", 20);
  const actualRunAttempt = integer(run.run_attempt, "The source release run attempt", 10);
  const displayTitle = text(run.display_title, "The source release display title");
  const actualName = text(run.name, "The source release workflow name");
  const expectedDisplayTitle = `Kin Resolve beta release run ${actualRunId} attempt ${actualRunAttempt}`;

  if (actualRunId !== expectedRunId
      || actualRunAttempt !== expectedRunAttempt
      || text(run.status, "The source release status") !== "completed"
      || text(run.conclusion, "The source release conclusion") !== "success"
      || text(run.event, "The source release event") !== "workflow_dispatch"
      || text(run.head_branch, "The source release branch") !== "main"
      || sha(run.head_sha, "The source release head SHA") !== expectedHeadSha
      || text(run.path, "The source release workflow path") !== workflowPath
      || (actualName !== workflowName && actualName !== displayTitle)
      || displayTitle !== expectedDisplayTitle
      || nestedRepository(run.repository, "The source release repository") !== expectedRepository
      || nestedRepository(run.head_repository, "The source release head repository")
        !== expectedRepository) {
    throw new Error("The source release run does not match the staging-only provenance contract.");
  }

  const createdAt = timestamp(run.created_at, "The source release creation time");
  const now = expectations.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("The source validation time is malformed.");
  const maximumAgeMs = expectations.maximumAgeMs ?? defaultMaximumAgeMs;
  if (!Number.isSafeInteger(maximumAgeMs) || maximumAgeMs <= 0) {
    throw new Error("The source release freshness window is malformed.");
  }
  const ageMs = now.getTime() - createdAt.getTime();
  if (ageMs < -futureClockToleranceMs) {
    throw new Error("The source release creation time is unacceptably in the future.");
  }
  if (ageMs > maximumAgeMs) {
    throw new Error("The source staging-only release is too old to open a demo session.");
  }

  validateJobs(jobsDocument);
  const evidence = validateCandidateEvidence(evidenceDocument, {
    repository: expectedRepository,
    runId: actualRunId,
    runAttempt: actualRunAttempt,
    headSha: expectedHeadSha
  });
  return {
    runId: actualRunId,
    runAttempt: actualRunAttempt,
    headSha: expectedHeadSha,
    createdAt: createdAt.toISOString(),
    releaseVersion: evidence.releaseVersion,
    candidateDeploymentId: evidence.candidateDeploymentId
  };
}

export function createStagingDemoCandidateEvidence(
  input: CreateStagingDemoCandidateEvidenceInput
): StagingDemoCandidateEvidence {
  return Object.freeze({
    schemaVersion: 1,
    kind: "kinresolve-staging-demo-candidate-v1",
    repository: repository(input.repository),
    workflowPath,
    runId: strictInteger(input.runId, "The release run ID", 20),
    runAttempt: strictInteger(input.runAttempt, "The release run attempt", 10),
    headSha: sha(input.headSha, "The release head SHA"),
    releaseVersion: releaseVersion(input.releaseVersion),
    candidateDeploymentId: deploymentId(input.candidateDeploymentId)
  });
}

function validateJobs(value: unknown): void {
  const document = object(value, "The source release jobs response");
  if (!Number.isSafeInteger(document.total_count)
      || (document.total_count as number) < 0
      || (document.total_count as number) > 100
      || !Array.isArray(document.jobs)
      || document.jobs.length !== document.total_count
      || document.jobs.length !== requiredJobConclusions.size) {
    throw new Error("The source release job evidence is incomplete or malformed.");
  }

  const matches = new Map<string, JsonObject[]>();
  for (const rawJob of document.jobs) {
    const job = object(rawJob, "A source release job");
    const name = text(job.name, "A source release job name");
    if (!requiredJobConclusions.has(name)) {
      throw new Error("The source release job evidence contains an unexpected job.");
    }
    const values = matches.get(name) ?? [];
    values.push(job);
    matches.set(name, values);
  }

  for (const [name, expectedConclusion] of requiredJobConclusions) {
    const jobs = matches.get(name) ?? [];
    if (jobs.length !== 1) {
      throw new Error(`The staging-only source job evidence for ${name} is missing or duplicate.`);
    }
    const job = jobs[0];
    if (text(job.status, `The ${name} job status`) !== "completed"
        || text(job.conclusion, `The ${name} job conclusion`) !== expectedConclusion) {
      throw new Error(`The ${name} job does not prove a successful staging-only release.`);
    }
  }
}

function validateCandidateEvidence(
  value: unknown,
  expected: {
    repository: string;
    runId: string;
    runAttempt: string;
    headSha: string;
  }
): StagingDemoCandidateEvidence {
  const evidence = object(value, "The staging candidate evidence");
  requireExactKeys(evidence, [
    "schemaVersion",
    "kind",
    "repository",
    "workflowPath",
    "runId",
    "runAttempt",
    "headSha",
    "releaseVersion",
    "candidateDeploymentId"
  ], "The staging candidate evidence");
  if (evidence.schemaVersion !== 1
      || evidence.kind !== "kinresolve-staging-demo-candidate-v1"
      || evidence.workflowPath !== workflowPath
      || repository(evidence.repository) !== expected.repository
      || strictInteger(evidence.runId, "The evidence run ID", 20) !== expected.runId
      || strictInteger(evidence.runAttempt, "The evidence run attempt", 10)
        !== expected.runAttempt
      || sha(evidence.headSha, "The evidence head SHA") !== expected.headSha) {
    throw new Error("The staging candidate evidence does not match the source release.");
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: "kinresolve-staging-demo-candidate-v1",
    repository: expected.repository,
    workflowPath,
    runId: expected.runId,
    runAttempt: expected.runAttempt,
    headSha: expected.headSha,
    releaseVersion: releaseVersion(evidence.releaseVersion),
    candidateDeploymentId: deploymentId(evidence.candidateDeploymentId)
  });
}

function nestedRepository(value: unknown, label: string): string {
  return repository(text(object(value, label).full_name, `${label} name`));
}

function repository(value: unknown): string {
  const normalized = text(value, "A repository name");
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(normalized)) {
    throw new Error("A source release repository name is malformed.");
  }
  return normalized;
}

function timestamp(value: unknown, label: string): Date {
  const normalized = text(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(normalized)) {
    throw new Error(`${label} is malformed.`);
  }
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} is malformed.`);
  return parsed;
}

function sha(value: unknown, label: string): string {
  const normalized = text(value, label);
  if (!/^[a-f0-9]{40}$/.test(normalized)) throw new Error(`${label} is malformed.`);
  return normalized;
}

function integer(value: unknown, label: string, maximumDigits: number): string {
  const normalized = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : value;
  if (typeof normalized !== "string"
      || !new RegExp(`^[1-9][0-9]{0,${maximumDigits - 1}}$`).test(normalized)) {
    throw new Error(`${label} is malformed.`);
  }
  return normalized;
}

function strictInteger(value: unknown, label: string, maximumDigits: number): string {
  if (typeof value !== "string"
      || !new RegExp(`^[1-9][0-9]{0,${maximumDigits - 1}}$`).test(value)) {
    throw new Error(`${label} is malformed.`);
  }
  return value;
}

function releaseVersion(value: unknown): string {
  const normalized = text(value, "The staging candidate release version");
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(normalized)) {
    throw new Error("The staging candidate release version is malformed.");
  }
  return normalized;
}

function deploymentId(value: unknown): string {
  const normalized = text(value, "The staging candidate deployment ID");
  if (!/^dpl_[A-Za-z0-9]{8,96}$/.test(normalized)) {
    throw new Error("The staging candidate deployment ID is malformed.");
  }
  return normalized;
}

function requireExactKeys(
  value: JsonObject,
  expectedKeys: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length
      || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} contains unexpected or missing fields.`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is malformed.`);
  }
  return value;
}

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is malformed.`);
  }
  return value as JsonObject;
}
