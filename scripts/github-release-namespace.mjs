#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import {
  githubReleaseDraftOwnerMarker,
  validateGitHubReleaseNamespace
} from "../lib/github-release-namespace.ts";

let command = "unknown";
try {
  const [requestedCommand, listingPath, remoteTagValue, ...unexpected] = process.argv.slice(2);
  command = requestedCommand ?? "unknown";
  if (command === "owner-marker") {
    if (listingPath || remoteTagValue || unexpected.length > 0) {
      throw new Error("Invalid owner marker arguments.");
    }
    console.log(githubReleaseDraftOwnerMarker(expectation("absent")));
  } else if (
    command === "repairable"
    || command === "publication"
    || command === "draft"
    || command === "published"
  ) {
    if (!listingPath || !remoteTagValue || unexpected.length > 0) {
      throw new Error("Invalid release namespace arguments.");
    }
    const bytes = await readFile(listingPath);
    if (bytes.byteLength < 2 || bytes.byteLength > 8_388_608) {
      throw new Error("The GitHub release listing has an invalid size.");
    }
    const state = validateGitHubReleaseNamespace(
      JSON.parse(bytes.toString("utf8")),
      expectation(remoteTagValue),
      command
    );
    console.log(JSON.stringify(state));
  } else {
    throw new Error("Unknown release namespace command.");
  }
} catch {
  console.error(`GitHub release namespace ${command} failed.`);
  process.exitCode = 1;
}

function expectation(remoteTagValue) {
  return {
    repository: required("GITHUB_REPOSITORY"),
    releaseTag: required("RELEASE_TAG"),
    releaseCommit: required("RELEASE_COMMIT"),
    releaseVersion: required("RELEASE_VERSION"),
    releaseMode: required("RELEASE_MODE"),
    workflowRunId: required("RELEASE_WORKFLOW_RUN_ID"),
    remoteTagSha: remoteTagValue === "absent" ? null : remoteTagValue
  };
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value || /[\0\r\n]/u.test(value)) throw new Error(`Missing ${name}.`);
  return value;
}
