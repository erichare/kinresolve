export const productionReleaseJobName = "Deploy and promote production candidate";
export const publishReleaseJobName = "Publish stable GitHub release";
export const canonicalPublicationRevalidationStepName =
  "Revalidate the live canonical candidate before publication";

export type ReleaseContainmentDecision = {
  shouldContain: boolean;
  reason: string;
  candidateRunAttempt?: number;
};

type WorkflowJob = Record<string, unknown> & {
  id: number;
  name: string;
  conclusion: string;
  run_attempt: number;
};

const productionFailureConclusions = new Set(["failure", "cancelled", "timed_out"]);

export function classifyReleaseContainment(
  allExecutionsValue: unknown,
  currentAttemptValue: unknown
): ReleaseContainmentDecision {
  const allJobs = readCompleteJobPage(allExecutionsValue);
  const currentJobs = readCompleteJobPage(currentAttemptValue);
  if (!allJobs || !currentJobs) return contain("job-list-ambiguous");

  if (new Set(currentJobs.map((job) => job.run_attempt)).size !== 1) {
    return contain("job-list-ambiguous");
  }
  const allById = new Map(allJobs.map((job) => [job.id, job]));
  if (allById.size !== allJobs.length) return contain("job-list-ambiguous");
  for (const current of currentJobs) {
    const historical = allById.get(current.id);
    if (
      !historical
      || historical.name !== current.name
      || historical.conclusion !== current.conclusion
      || historical.run_attempt !== current.run_attempt
    ) {
      return contain("job-list-ambiguous");
    }
  }

  const currentProduction = exactNamedJob(currentJobs, productionReleaseJobName);
  if (currentProduction === "ambiguous") return contain("production-job-ambiguous");
  const currentPublication = exactNamedJob(currentJobs, publishReleaseJobName);
  if (currentPublication === "ambiguous") return contain("publication-job-ambiguous");

  if (!currentProduction && !currentPublication) {
    return { shouldContain: false, reason: "non-production-attempt" };
  }

  if (currentProduction) {
    if (currentProduction.conclusion === "skipped") {
      return { shouldContain: false, reason: "production-skipped" };
    }
    if (productionFailureConclusions.has(currentProduction.conclusion)) {
      return contain("production-failed", currentProduction.run_attempt);
    }
    if (currentProduction.conclusion !== "success") {
      return contain("production-result-ambiguous");
    }
    if (!currentPublication) return contain("publication-job-ambiguous", currentProduction.run_attempt);
    return classifyPublication(currentPublication, currentProduction.run_attempt);
  }

  const priorProduction = newestNamedJobBeforeAttempt(
    allJobs,
    productionReleaseJobName,
    currentPublication!.run_attempt
  );
  if (priorProduction === "ambiguous" || !priorProduction || priorProduction.conclusion !== "success") {
    return contain("production-result-ambiguous");
  }
  return classifyPublication(currentPublication!, priorProduction.run_attempt);
}

function classifyPublication(
  publication: WorkflowJob,
  candidateRunAttempt: number
): ReleaseContainmentDecision {
  if (publication.conclusion === "success") {
    return { shouldContain: false, reason: "release-finished" };
  }
  if (!Array.isArray(publication.steps)) {
    return contain("publication-steps-ambiguous", candidateRunAttempt);
  }
  const revalidationMatches = publication.steps.filter(
    (step) => isRecord(step) && step.name === canonicalPublicationRevalidationStepName
  );
  if (revalidationMatches.length !== 1) {
    return contain("publication-revalidation-ambiguous", candidateRunAttempt);
  }
  if (revalidationMatches[0].conclusion !== "success") {
    return contain("canonical-revalidation-not-proven", candidateRunAttempt);
  }
  return { shouldContain: false, reason: "publication-only-failure" };
}

function readCompleteJobPage(value: unknown): WorkflowJob[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.jobs)) return undefined;
  const { jobs } = value;
  if (
    !Number.isSafeInteger(value.total_count)
    || (value.total_count as number) !== jobs.length
    || jobs.length < 1
    || jobs.length > 100
  ) {
    return undefined;
  }
  if (!jobs.every(isWorkflowJob)) return undefined;
  return jobs;
}

function exactNamedJob(jobs: WorkflowJob[], name: string): WorkflowJob | "ambiguous" | undefined {
  const matches = jobs.filter((job) => job.name === name);
  if (matches.length > 1) return "ambiguous";
  return matches[0];
}

function newestNamedJobBeforeAttempt(
  jobs: WorkflowJob[],
  name: string,
  beforeAttempt: number
): WorkflowJob | "ambiguous" | undefined {
  const matches = jobs
    .filter((job) => job.name === name && job.run_attempt < beforeAttempt)
    .sort((left, right) => right.run_attempt - left.run_attempt);
  if (matches.length > 1 && matches[0].run_attempt === matches[1].run_attempt) return "ambiguous";
  return matches[0];
}

function contain(reason: string, candidateRunAttempt?: number): ReleaseContainmentDecision {
  return {
    shouldContain: true,
    reason,
    ...(candidateRunAttempt === undefined ? {} : { candidateRunAttempt })
  };
}

function isWorkflowJob(value: unknown): value is WorkflowJob {
  return isRecord(value)
    && Number.isSafeInteger(value.id)
    && (value.id as number) > 0
    && typeof value.name === "string"
    && value.name.length > 0
    && typeof value.conclusion === "string"
    && value.conclusion.length > 0
    && Number.isSafeInteger(value.run_attempt)
    && (value.run_attempt as number) > 0
    && (value.run_attempt as number) <= 9_999_999_999;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
