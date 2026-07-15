#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { classifyReleaseContainment } from "../lib/release-containment-classifier.ts";

try {
  const [allExecutionsPath, currentAttemptPath, ...unexpected] = process.argv.slice(2);
  if (!allExecutionsPath || !currentAttemptPath || unexpected.length > 0) {
    throw new Error(
      "Usage: classify-release-containment.mjs <all-workflow-jobs.json> <current-attempt-jobs.json>."
    );
  }
  const decision = classifyReleaseContainment(
    JSON.parse(await readFile(allExecutionsPath, "utf8")),
    JSON.parse(await readFile(currentAttemptPath, "utf8"))
  );
  if (!/^[a-z][a-z-]{2,63}$/.test(decision.reason)) {
    throw new Error("The release containment decision reason is invalid.");
  }
  const candidateRunAttempt = decision.candidateRunAttempt === undefined
    ? "none"
    : String(decision.candidateRunAttempt);
  if (!/^(none|[1-9][0-9]{0,9})$/.test(candidateRunAttempt)) {
    throw new Error("The release containment candidate attempt is invalid.");
  }
  process.stdout.write(
    `${decision.shouldContain ? "true" : "false"} ${decision.reason} ${candidateRunAttempt}\n`
  );
} catch {
  console.error("Release containment classification failed.");
  process.exitCode = 1;
}
