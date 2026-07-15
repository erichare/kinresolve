import { describe, expect, it } from "vitest";

import {
  canonicalPublicationRevalidationStepName,
  classifyReleaseContainment,
  productionReleaseJobName,
  publishReleaseJobName
} from "@/lib/release-containment-classifier";

let nextJobId = 100;

function job(name: string, conclusion: string, steps: Array<Record<string, unknown>> = []) {
  return { id: nextJobId++, name, conclusion, run_attempt: 1, steps };
}

function page(jobs: Array<Record<string, unknown>>): Record<string, unknown> {
  return { total_count: jobs.length, jobs };
}

function classify(currentJobs: Array<Record<string, unknown>>, priorJobs: Array<Record<string, unknown>> = []) {
  return classifyReleaseContainment(page([...priorJobs, ...currentJobs]), page(currentJobs));
}

function publication(conclusion: string, revalidationConclusion?: string) {
  return job(
    publishReleaseJobName,
    conclusion,
    revalidationConclusion === undefined ? [] : [{
      name: canonicalPublicationRevalidationStepName,
      conclusion: revalidationConclusion
    }]
  );
}

describe("release containment classification", () => {
  it.each(["failure", "cancelled", "timed_out"])(
    "contains when the current production job concludes %s",
    (conclusion) => {
      expect(classify([job(productionReleaseJobName, conclusion)])).toEqual({
        shouldContain: true,
        reason: "production-failed",
        candidateRunAttempt: 1
      });
    }
  );

  it("does not disturb production when the current production job was skipped", () => {
    expect(classify([job(productionReleaseJobName, "skipped")])).toEqual({
      shouldContain: false,
      reason: "production-skipped"
    });
  });

  it("does not disturb production for a failed attempt with no production-phase jobs", () => {
    expect(classify([job("Verify release", "failure")])).toEqual({
      shouldContain: false,
      reason: "non-production-attempt"
    });
  });

  it("leaves a healthy canonical deployment live for a publication-only failure", () => {
    expect(classify([
      job(productionReleaseJobName, "success"),
      publication("failure", "success")
    ])).toEqual({
      shouldContain: false,
      reason: "publication-only-failure"
    });
  });

  it("classifies a publication-only rerun against the newest successful prior production job", () => {
    const priorProduction = { ...job(productionReleaseJobName, "success"), run_attempt: 1 };
    const rerunPublication = { ...publication("failure", "success"), run_attempt: 2 };
    expect(classify([rerunPublication], [priorProduction])).toEqual({
      shouldContain: false,
      reason: "publication-only-failure"
    });
  });

  it("returns the candidate-owning prior attempt for an unsafe publication-only rerun", () => {
    const priorProduction = { ...job(productionReleaseJobName, "success"), run_attempt: 1 };
    const rerunPublication = { ...publication("cancelled"), run_attempt: 2 };
    expect(classify([rerunPublication], [priorProduction])).toEqual({
      shouldContain: true,
      reason: "publication-revalidation-ambiguous",
      candidateRunAttempt: 1
    });
  });

  it("fails closed when a publication rerun has ambiguous production ownership", () => {
    const priorOne = { ...job(productionReleaseJobName, "success"), run_attempt: 1 };
    const priorDuplicate = { ...job(productionReleaseJobName, "success"), run_attempt: 1 };
    const rerunPublication = { ...publication("failure"), run_attempt: 2 };
    expect(classify([rerunPublication], [priorOne, priorDuplicate])).toEqual({
      shouldContain: true,
      reason: "production-result-ambiguous"
    });
  });

  it.each([undefined, "failure", "cancelled", "skipped"])(
    "contains when publication revalidation is not proven successful (%s)",
    (revalidationConclusion) => {
      expect(classify([
        job(productionReleaseJobName, "success"),
        publication("failure", revalidationConclusion)
      ]).shouldContain).toBe(true);
    }
  );

  it("leaves a fully successful production and publication phase live", () => {
    expect(classify([
      job(productionReleaseJobName, "success"),
      publication("success", "success")
    ])).toEqual({ shouldContain: false, reason: "release-finished" });
  });

  it.each([
    [{}, {}],
    [{ total_count: 2, jobs: [job(productionReleaseJobName, "failure")] }, page([])],
    [page([]), page([])],
    [page([job(productionReleaseJobName, "neutral")]), page([job("different", "failure")])]
  ])("fails closed for ambiguous job evidence", (allJobs, currentJobs) => {
    expect(classifyReleaseContainment(allJobs, currentJobs).shouldContain).toBe(true);
  });

  it("fails closed when the current page is not a consistent subset of all executions", () => {
    const current = job(productionReleaseJobName, "failure");
    expect(classifyReleaseContainment(
      page([{ ...current, conclusion: "success" }]),
      page([current])
    ).shouldContain).toBe(true);
  });

  it("fails closed for duplicate production jobs or publication revalidation steps", () => {
    expect(classify([
      job(productionReleaseJobName, "failure"),
      job(productionReleaseJobName, "failure")
    ]).shouldContain).toBe(true);

    const duplicateStep = publication("failure", "success");
    duplicateStep.steps.push({
      name: canonicalPublicationRevalidationStepName,
      conclusion: "success"
    });
    expect(classify([
      job(productionReleaseJobName, "success"),
      duplicateStep
    ]).shouldContain).toBe(true);
  });
});
