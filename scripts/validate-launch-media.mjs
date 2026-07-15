#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { createFile as createMp4File } from "mp4box";
import sharp from "sharp";
import { buildTranscript, buildWebVtt } from "./launch-media-text.mjs";

const root = process.cwd();
const directory = path.join(root, "site", "public", "assets", "launch");
const contentBytes = await readFile(path.join(root, "site", "lib", "launch-media-content.json"));
const content = JSON.parse(contentBytes.toString("utf8"));
const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));

requireExactKeys(content, ["captures", "schemaVersion", "segments"], "canonical launch content");
if (
  content.schemaVersion !== 1
  || !Array.isArray(content.captures)
  || content.captures.length !== 8
  || !Array.isArray(content.segments)
  || content.segments.length !== 8
) {
  throw new Error("Canonical launch-media content is invalid.");
}
for (const [index, record] of content.captures.entries()) {
  requireExactKeys(record, ["alt", "body", "filename", "number", "title"], "canonical capture");
  if (
    record.number !== String(index + 1).padStart(2, "0")
    || !/^\d{2}-[a-z0-9-]+\.webp$/.test(record.filename)
    || typeof record.alt !== "string"
    || record.alt.length < 40
    || !record.alt.includes("Kin Resolve")
    || typeof record.body !== "string"
    || record.body.length < 40
    || typeof record.title !== "string"
    || record.title.length < 8
  ) {
    throw new Error(`Canonical launch capture ${index + 1} is invalid.`);
  }
}
let canonicalDuration = 0;
for (const [index, segment] of content.segments.entries()) {
  requireExactKeys(segment, ["durationSeconds", "image", "text"], "canonical segment");
  if (
    !Number.isSafeInteger(segment.durationSeconds)
    || segment.durationSeconds < 1
    || segment.image !== content.captures[index].filename
    || typeof segment.text !== "string"
    || segment.text.length < 40
  ) {
    throw new Error(`Canonical launch segment ${index + 1} is invalid.`);
  }
  canonicalDuration += segment.durationSeconds;
}
if (canonicalDuration !== 90) throw new Error("Canonical launch segments do not total 90 seconds.");

const expectedPublicFiles = [
  ...content.captures.map((record) => record.filename),
  "kin-resolve-private-beta-demo.mp4",
  "kin-resolve-private-beta-demo-poster.webp",
  "kin-resolve-private-beta-demo-transcript.md",
  "kin-resolve-private-beta-demo.vtt",
  "manifest.json"
].sort();
const publicEntries = await readdir(directory, { withFileTypes: true });
if (
  publicEntries.some((entry) => !entry.isFile())
  || JSON.stringify(publicEntries.map((entry) => entry.name).sort()) !== JSON.stringify(expectedPublicFiles)
) {
  throw new Error("Public launch-media directory contains a missing, extra, or non-regular entry.");
}

requireExactKeys(manifest, [
  "captures",
  "contentSha256",
  "dataset",
  "demoFixtureVersion",
  "schemaVersion",
  "sourceCommit",
  "video",
  "viewport"
], "public manifest");
requireExactKeys(manifest.viewport, ["height", "width"], "public viewport");
if (
  manifest.schemaVersion !== 1
  || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit ?? "")
  || manifest.contentSha256 !== sha256(contentBytes)
  || manifest.dataset !== "Hartwell-Mercer fictional demo"
  || manifest.demoFixtureVersion !== 1
  || manifest.viewport.width !== 1600
  || manifest.viewport.height !== 1000
  || !Array.isArray(manifest.captures)
  || manifest.captures.length !== content.captures.length
) {
  throw new Error("Public launch-media manifest is invalid.");
}

const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", manifest.sourceCommit, "HEAD"], {
  stdio: "ignore"
});
if (ancestor.error || ancestor.status !== 0) {
  throw new Error("Public launch media is not pinned to an ancestor of the checked-out release.");
}

for (const [index, record] of manifest.captures.entries()) {
  requireExactKeys(record, ["alt", "filename", "sha256", "title"], "public capture");
  const expected = content.captures[index];
  if (
    record.filename !== expected.filename
    || record.title !== expected.title
    || record.alt !== expected.alt
  ) {
    throw new Error(`Public launch image ${record.filename ?? "unknown"} diverges from canonical content.`);
  }
  const file = path.join(directory, record.filename);
  const bytes = await verifiedFile(file, record.sha256, 1_500_000);
  const metadata = await sharp(bytes).metadata();
  if (
    metadata.format !== "webp"
    || metadata.width !== 1600
    || metadata.height !== 1000
    || metadata.exif
    || metadata.xmp
  ) {
    throw new Error(`Public launch image ${record.filename} failed its format or metadata contract.`);
  }
}

const video = manifest.video;
requireExactKeys(video, [
  "audio",
  "captions",
  "captionsSha256",
  "durationSeconds",
  "filename",
  "poster",
  "posterSha256",
  "segments",
  "sha256",
  "transcript",
  "transcriptSha256"
], "public video");
if (
  video.filename !== "kin-resolve-private-beta-demo.mp4"
  || video.poster !== "kin-resolve-private-beta-demo-poster.webp"
  || video.captions !== "kin-resolve-private-beta-demo.vtt"
  || video.transcript !== "kin-resolve-private-beta-demo-transcript.md"
  || video.audio !== "deterministic wordless mathematical tone bed"
  || !Number.isFinite(video.durationSeconds)
  || Math.abs(video.durationSeconds - 90) > 0.08
  || JSON.stringify(video.segments) !== JSON.stringify(content.segments)
) {
  throw new Error("Public launch-video manifest is invalid or predates the wordless media contract.");
}
const videoBytes = await verifiedFile(path.join(directory, video.filename), video.sha256, 24 * 1024 * 1024);
validateVideoStreams(videoBytes);
const unsafeBinaryText = videoBytes.toString("latin1");
for (const marker of ["/Users/", "postgres://", "127.0.0.1", "kinresolve_browser_canary", "@example.test"]) {
  if (unsafeBinaryText.includes(marker)) {
    throw new Error("Public launch video contains a local or private capture marker.");
  }
}
const posterBytes = await verifiedFile(path.join(directory, video.poster), video.posterSha256, 1_500_000);
const posterMetadata = await sharp(posterBytes).metadata();
if (
  posterMetadata.format !== "webp"
  || posterMetadata.width !== 1600
  || posterMetadata.height !== 900
  || posterMetadata.exif
  || posterMetadata.xmp
) {
  throw new Error("Public launch-video poster failed its format or metadata contract.");
}
const captions = (await verifiedFile(path.join(directory, video.captions), video.captionsSha256, 64 * 1024))
  .toString("utf8");
if (captions !== buildWebVtt(content.segments)) {
  throw new Error("Public launch-video captions diverge from canonical content or timing.");
}
const transcript = (await verifiedFile(
  path.join(directory, video.transcript),
  video.transcriptSha256,
  64 * 1024
)).toString("utf8");
if (transcript !== buildTranscript(content.segments, manifest.sourceCommit)) {
  throw new Error("Public launch-video transcript diverges from canonical content or timing.");
}

console.log(`Synthetic launch media verified for source commit ${manifest.sourceCommit}.`);

async function verifiedFile(file, expectedDigest, maximumBytes) {
  if (!/^[a-f0-9]{64}$/.test(expectedDigest ?? "")) throw new Error("Launch-media digest is invalid.");
  const metadata = await stat(file);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximumBytes) {
    throw new Error(`Launch asset ${path.basename(file)} exceeds its size contract.`);
  }
  const bytes = await readFile(file);
  if (sha256(bytes) !== expectedDigest) {
    throw new Error(`Launch asset ${path.basename(file)} failed its digest check.`);
  }
  return bytes;
}

function validateVideoStreams(bytes) {
  const parser = createMp4File();
  let parseError;
  let movie;
  parser.onError = (error) => { parseError = error; };
  parser.onReady = (info) => { movie = info; };
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  data.fileStart = 0;
  parser.appendBuffer(data);
  parser.flush();
  if (parseError || !movie || !Array.isArray(movie.tracks)) {
    throw new Error("The pure-JavaScript MP4 parser rejected the public launch video.");
  }
  const videoTracks = movie.tracks.filter((track) => track.video);
  const audioTracks = movie.tracks.filter((track) => track.audio);
  const duration = movie.duration / movie.timescale;
  const videoDuration = videoTracks[0]?.duration / videoTracks[0]?.timescale;
  const audioDuration = audioTracks[0]?.duration / audioTracks[0]?.timescale;
  if (
    movie.tracks.length !== 2
    || videoTracks.length !== 1
    || audioTracks.length !== 1
    || !videoTracks[0].codec.startsWith("avc1.")
    || videoTracks[0].video.width !== 1600
    || videoTracks[0].video.height !== 1000
    || videoTracks[0].nb_samples !== 2_700
    || audioTracks[0].codec !== "mp4a.40.2"
    || audioTracks[0].audio.sample_rate !== 48_000
    || audioTracks[0].audio.channel_count !== 2
    || movie.isFragmented !== false
    || movie.isProgressive !== true
    || !Number.isFinite(duration)
    || Math.abs(duration - 90) > 0.08
    || !Number.isFinite(videoDuration)
    || Math.abs(videoDuration - 90) > 0.08
    || !Number.isFinite(audioDuration)
    || Math.abs(audioDuration - 90) > 0.08
  ) {
    throw new Error("Public launch video failed its independently parsed stream contract.");
  }
}

function requireExactKeys(value, keys, label) {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())
  ) {
    throw new Error(`The ${label} schema is not exact.`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
