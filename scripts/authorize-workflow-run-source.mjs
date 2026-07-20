#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";

import { authorizeWorkflowRunSource } from "../lib/workflow-run-source-authorization.ts";

try {
  if (process.argv.length > 2) {
    throw new Error(
      "Usage: authorize-workflow-run-source.mjs (configuration is provided by environment variables)."
    );
  }
  const event = await readJson(required("GITHUB_EVENT_PATH"), "workflow_run event");
  const expectedSourceWorkflowName = optional("EXPECTED_SOURCE_WORKFLOW_NAME");
  const expectedSourceWorkflowId = optional("EXPECTED_SOURCE_WORKFLOW_ID");
  const displayTitleTemplates = templates(optional("DISPLAY_TITLE_TEMPLATES"));
  const result = authorizeWorkflowRunSource(event, {
    currentRepository: required("GITHUB_REPOSITORY"),
    expectedSourceWorkflowPath: required("EXPECTED_SOURCE_WORKFLOW_PATH"),
    ...(expectedSourceWorkflowName === undefined ? {} : { expectedSourceWorkflowName }),
    ...(expectedSourceWorkflowId === undefined ? {} : { expectedSourceWorkflowId }),
    allowedSourceEvents: list(required("ALLOWED_SOURCE_EVENTS")),
    allowedSourceConclusions: list(required("ALLOWED_SOURCE_CONCLUSIONS")),
    requiredHeadBranch: required("REQUIRED_HEAD_BRANCH"),
    ...(displayTitleTemplates === undefined ? {} : { displayTitleTemplates })
  });
  if (!result.authorized) throw new Error(result.reason);
  const lines = ["authorized=true"];
  for (const key of Object.keys(result.outputs).sort()) {
    lines.push(`${key}=${result.outputs[key]}`);
  }
  const output = `${lines.join("\n")}\n`;
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, output, "utf8");
  process.stdout.write(output);
} catch (error) {
  console.error(error instanceof Error
    ? `Workflow run source authorization failed: ${error.message}`
    : "Workflow run source authorization failed.");
  process.exitCode = 1;
}

async function readJson(filePath, label) {
  let contents;
  try {
    contents = await readFile(filePath, "utf8");
  } catch {
    throw new Error(`Unable to read the ${label} payload.`);
  }
  try {
    return JSON.parse(contents);
  } catch {
    throw new Error(`The ${label} payload is malformed.`);
  }
}

function templates(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("DISPLAY_TITLE_TEMPLATES is not valid JSON.");
  }
}

function list(value) {
  const entries = value.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
  if (entries.length === 0) throw new Error("An allowed-value list is empty.");
  return entries;
}

function optional(name) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
