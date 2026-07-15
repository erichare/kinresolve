#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import launchMediaContent from "../site/lib/launch-media-content.json" with { type: "json" };
import { buildTranscript, buildWebVtt } from "./launch-media-text.mjs";

const segments = launchMediaContent.segments.map((segment) => ({
  duration: segment.durationSeconds,
  image: segment.image,
  text: segment.text
}));

const exactDuration = segments.reduce((total, segment) => total + segment.duration, 0);
if (exactDuration !== 90) throw new Error("Launch-video segments must total exactly 90 seconds.");

const sourceCommit = process.argv[2]?.trim();
if (!sourceCommit || !/^[a-f0-9]{40}$/.test(sourceCommit)) {
  throw new Error("Usage: node scripts/build-launch-video.mjs <40-character-source-commit>");
}
if (
  process.env.KINRESOLVE_LAUNCH_VIDEO_ACKNOWLEDGEMENT
    !== "I confirm every launch-video frame, caption, transcript, and sound is fictional or generated from code."
) {
  throw new Error("Launch-video generation requires the exact synthetic-media acknowledgement.");
}

const root = process.cwd();
const directory = path.join(root, "output", "launch-media", sourceCommit);
const temporaryDirectory = path.join(directory, ".video-build");
const capturePath = path.join(directory, "capture.json");
const capture = JSON.parse(await readFile(capturePath, "utf8"));
const contentSha256 = sha256(await readFile(path.join(root, "site", "lib", "launch-media-content.json")));
if (
  capture?.schemaVersion !== 1
  || capture?.sourceCommit !== sourceCommit
  || capture?.contentSha256 !== contentSha256
  || capture?.dataset !== "Hartwell-Mercer fictional demo"
  || !Array.isArray(capture?.captures)
  || capture.captures.length !== segments.length
) {
  throw new Error("The launch-video capture manifest does not match the exact synthetic source commit.");
}
for (const segment of segments) {
  const record = capture.captures.find((candidate) => candidate?.filename === segment.image);
  const bytes = await readFile(path.join(directory, segment.image));
  if (!record || record.sha256 !== sha256(bytes)) {
    throw new Error(`Launch image ${segment.image} does not match the capture manifest.`);
  }
}

await rm(temporaryDirectory, { recursive: true, force: true });
await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });

const videoParts = [];
let cursor = 0;

for (const [index, segment] of segments.entries()) {
  const number = String(index + 1).padStart(2, "0");
  const videoPart = path.join(temporaryDirectory, `${number}.mp4`);
  const inputImage = path.join(directory, segment.image);

  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-loop", "1", "-i", inputImage,
    "-t", String(segment.duration),
    "-vf", `zoompan=z='min(zoom+0.00012,1.035)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${segment.duration * 30}:s=1600x1000:fps=30,format=yuv420p`,
    "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "24",
    "-movflags", "+faststart", "-map_metadata", "-1", videoPart
  ]);

  videoParts.push(videoPart);
  cursor += segment.duration;
}
if (cursor !== 90) throw new Error("Launch-video frame sequence did not end at exactly 90 seconds.");

const videoList = path.join(temporaryDirectory, "video.txt");
await writeFile(videoList, concatList(videoParts), { encoding: "utf8", mode: 0o600 });
const joinedVideo = path.join(temporaryDirectory, "joined-video.mp4");
const joinedAudio = path.join(temporaryDirectory, "joined-audio.wav");
run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", videoList,
  "-c", "copy", "-map_metadata", "-1", joinedVideo
]);
run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "lavfi",
  "-i", "aevalsrc=0.018*sin(2*PI*110*t)+0.011*sin(2*PI*164.8138*t)+0.007*sin(2*PI*220*t)+0.003*sin(2*PI*0.125*t)*sin(2*PI*329.6276*t):s=48000:d=90",
  "-af", "lowpass=f=720,afade=t=in:st=0:d=3,afade=t=out:st=87:d=3",
  "-t", "90", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", "-map_metadata", "-1",
  joinedAudio
]);
if (Math.abs(probeDuration(joinedAudio) - 90) > 0.03) {
  throw new Error("The deterministic wordless launch-video audio bed is not exactly 90 seconds.");
}

const videoPath = path.join(directory, "kin-resolve-private-beta-demo.mp4");
const captionsPath = path.join(directory, "kin-resolve-private-beta-demo.vtt");
const transcriptPath = path.join(directory, "kin-resolve-private-beta-demo-transcript.md");
const posterPath = path.join(directory, "kin-resolve-private-beta-demo-poster.webp");
run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-i", joinedVideo, "-i", joinedAudio,
  "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "144k",
  "-t", "90", "-movflags", "+faststart", "-map_metadata", "-1", videoPath
]);
await writeFile(captionsPath, buildWebVtt(launchMediaContent.segments), { encoding: "utf8", mode: 0o600 });
await writeFile(transcriptPath, buildTranscript(launchMediaContent.segments, sourceCommit), {
  encoding: "utf8",
  mode: 0o600
});

const posterSource = await readFile(path.join(directory, segments[0].image));
const overlay = Buffer.from(`
  <svg width="1600" height="900" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#092f29" stop-opacity="0.96"/>
        <stop offset="0.57" stop-color="#092f29" stop-opacity="0.70"/>
        <stop offset="1" stop-color="#092f29" stop-opacity="0.15"/>
      </linearGradient>
    </defs>
    <rect width="1600" height="900" fill="url(#shade)"/>
    <text x="110" y="270" fill="#8de0c4" font-family="Arial, sans-serif" font-size="28" font-weight="700" letter-spacing="3">90-SECOND PRODUCT TOUR</text>
    <text x="110" y="365" fill="#fffdf7" font-family="Georgia, serif" font-size="72" font-weight="600">Evidence first.</text>
    <text x="110" y="445" fill="#fffdf7" font-family="Georgia, serif" font-size="72" font-weight="600">Deliberately small.</text>
    <text x="110" y="525" fill="#d6e8e2" font-family="Arial, sans-serif" font-size="27">The fictional Hartwell–Mercer archive · no real family data</text>
    <circle cx="150" cy="640" r="42" fill="#f5b84b"/>
    <polygon points="139,617 139,663 173,640" fill="#143d35"/>
    <text x="215" y="652" fill="#fffdf7" font-family="Arial, sans-serif" font-size="30" font-weight="700">Watch the Kin Resolve walkthrough</text>
  </svg>
`);
const poster = await sharp(posterSource)
  .resize(1600, 900, { fit: "cover", position: "top" })
  .composite([{ input: overlay }])
  .webp({ effort: 6, quality: 88 })
  .toBuffer();
await writeFile(posterPath, poster, { mode: 0o600 });

const duration = probeDuration(videoPath);
const probe = probeJson(videoPath);
const videoStream = probe.streams?.find((stream) => stream.codec_type === "video");
const audioStream = probe.streams?.find((stream) => stream.codec_type === "audio");
const audioDuration = Number(audioStream?.duration);
if (
  Math.abs(duration - 90) > 0.08
  || videoStream?.codec_name !== "h264"
  || videoStream?.width !== 1600
  || videoStream?.height !== 1000
  || audioStream?.codec_name !== "aac"
  || !Number.isFinite(audioDuration)
  || Math.abs(audioDuration - 90) > 0.08
) {
  throw new Error("The generated launch video failed its duration, codec, or frame contract.");
}

capture.video = {
  audio: "deterministic wordless mathematical tone bed",
  durationSeconds: duration,
  filename: path.basename(videoPath),
  poster: path.basename(posterPath),
  captions: path.basename(captionsPath),
  transcript: path.basename(transcriptPath),
  sha256: sha256(await readFile(videoPath)),
  posterSha256: sha256(poster),
  captionsSha256: sha256(await readFile(captionsPath)),
  transcriptSha256: sha256(await readFile(transcriptPath)),
  segments: launchMediaContent.segments
};
await writeFile(capturePath, `${JSON.stringify(capture, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
await rm(temporaryDirectory, { recursive: true, force: true });
console.log(`Built exact 90-second synthetic launch video for ${sourceCommit}.`);

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0) {
    throw new Error(`${path.basename(command)} failed while building launch media.`);
  }
}

function probeDuration(file) {
  const result = spawnSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const duration = Number(result.stdout?.trim());
  if (result.error || result.status !== 0 || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("ffprobe could not validate launch-media duration.");
  }
  return duration;
}

function probeJson(file) {
  const result = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", file], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error || result.status !== 0) throw new Error("ffprobe could not validate launch-media streams.");
  return JSON.parse(result.stdout);
}

function concatList(files) {
  return `${files.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n")}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
