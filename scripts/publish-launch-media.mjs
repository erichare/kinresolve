#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceCommit = process.argv[2]?.trim();
if (!sourceCommit || !/^[a-f0-9]{40}$/.test(sourceCommit)) {
  throw new Error("Usage: node scripts/publish-launch-media.mjs <40-character-source-commit>");
}
if (
  process.env.KINRESOLVE_LAUNCH_MEDIA_PUBLISH_ACKNOWLEDGEMENT
    !== "I verified this exact generated package contains only fictional Hartwell-Mercer launch media."
) {
  throw new Error("Launch-media publication requires the exact synthetic-package acknowledgement.");
}

const root = process.cwd();
if (
  gitOutput(["rev-parse", "HEAD"]) !== sourceCommit
  || gitOutput(["status", "--porcelain", "--untracked-files=all"])
) {
  throw new Error("Launch-media publication requires the exact clean reviewed source commit.");
}
const sourceDirectory = path.join(root, "output", "launch-media", sourceCommit);
const capture = JSON.parse(await readFile(path.join(sourceDirectory, "capture.json"), "utf8"));
const contentBytes = await readFile(path.join(root, "site", "lib", "launch-media-content.json"));
const content = JSON.parse(contentBytes.toString("utf8"));
if (
  capture?.schemaVersion !== 1
  || capture?.sourceCommit !== sourceCommit
  || !/^[a-f0-9]{64}$/.test(capture?.contentSha256 ?? "")
  || capture?.dataset !== "Hartwell-Mercer fictional demo"
  || capture?.demoFixtureVersion !== 1
  || !Array.isArray(capture?.captures)
  || capture.captures.length !== 8
  || !capture?.video
) {
  throw new Error("The generated launch-media package is incomplete or belongs to another source commit.");
}
if (sha256(contentBytes) !== capture.contentSha256) {
  throw new Error("The reviewed launch-media content changed after capture.");
}
if (
  capture.video.audio !== "deterministic wordless mathematical tone bed"
  || JSON.stringify(capture.video.segments) !== JSON.stringify(content.segments)
  || JSON.stringify(capture.captures.map(({ alt, filename, title }) => ({ alt, filename, title })))
    !== JSON.stringify(content.captures.map(({ alt, filename, title }) => ({ alt, filename, title })))
) {
  throw new Error("The reviewed package diverges from the canonical wordless media content.");
}

const imageNames = capture.captures.map((record) => record?.filename);
const expectedImages = [
  "01-synthetic-dashboard.webp",
  "02-durable-gedcom-source.webp",
  "03-review-before-apply.webp",
  "04-evidence-and-hypotheses.webp",
  "05-sources-in-context.webp",
  "06-deterministic-quality.webp",
  "07-scoped-developer-api.webp",
  "08-export-and-control.webp"
];
if (JSON.stringify(imageNames) !== JSON.stringify(expectedImages)) {
  throw new Error("The launch-media image sequence is not the approved eight-part synthetic tour.");
}

const videoFiles = [
  capture.video.filename,
  capture.video.poster,
  capture.video.captions,
  capture.video.transcript
];
const expectedVideoFiles = [
  "kin-resolve-private-beta-demo.mp4",
  "kin-resolve-private-beta-demo-poster.webp",
  "kin-resolve-private-beta-demo.vtt",
  "kin-resolve-private-beta-demo-transcript.md"
];
if (JSON.stringify(videoFiles) !== JSON.stringify(expectedVideoFiles)) {
  throw new Error("The launch-video filenames do not match the public asset contract.");
}

const records = [
  ...capture.captures.map((record) => ({ filename: record.filename, sha256: record.sha256 })),
  { filename: capture.video.filename, sha256: capture.video.sha256 },
  { filename: capture.video.poster, sha256: capture.video.posterSha256 },
  { filename: capture.video.captions, sha256: capture.video.captionsSha256 },
  { filename: capture.video.transcript, sha256: capture.video.transcriptSha256 }
];
for (const record of records) {
  if (!record?.filename || !/^[a-z0-9][a-z0-9.-]+$/.test(record.filename) || !/^[a-f0-9]{64}$/.test(record.sha256)) {
    throw new Error("The launch-media package contains an invalid file record.");
  }
  const bytes = await readFile(path.join(sourceDirectory, record.filename));
  if (sha256(bytes) !== record.sha256) {
    throw new Error(`Generated launch asset ${record.filename} failed its digest check.`);
  }
}

const destination = path.join(root, "site", "public", "assets", "launch");
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true, mode: 0o755 });
for (const record of records) {
  const target = path.join(destination, record.filename);
  await copyFile(path.join(sourceDirectory, record.filename), target);
}

const manifest = {
  schemaVersion: 1,
  sourceCommit,
  contentSha256: capture.contentSha256,
  dataset: capture.dataset,
  demoFixtureVersion: capture.demoFixtureVersion,
  viewport: capture.viewport,
  captures: capture.captures,
  video: capture.video
};
await writeFile(
  path.join(destination, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { encoding: "utf8", mode: 0o644 }
);
console.log(`Published ${records.length} verified synthetic launch assets from ${sourceCommit}.`);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function gitOutput(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }).trim();
}
