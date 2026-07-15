# Synthetic launch-media runbook

- **Status:** isolated, regeneratable production-build capture; publication still requires human privacy review
- **Dataset:** Hartwell–Mercer fictional demo only
- **Outputs:** eight 1600×1000 WebP frames, one exact 90-second H.264/AAC MP4, poster, WebVTT captions, transcript, and SHA-256 manifest

The public product tour must never be recorded from a pilot, staging account, provider
console, founder mailbox, or workstation containing real genealogy data. The capture
runner clones the exact commit into a disposable directory, installs its locked dependencies
with an empty npm user configuration, downloads that lockfile's Playwright Chromium, creates
an isolated Postgres database and MinIO store on loopback, builds in production mode,
provisions demo fixture version 1, creates a synthetic owner, records the tour, and destroys
the two containers, app process, dependencies, browser, and temporary checkout.

## Prerequisites

- a completely clean worktree at the exact source commit, including no untracked source files;
- Node 22 or newer and npm available on `PATH`;
- network access to the public npm registry, the Playwright browser CDN, and the font assets
  required by the production Next build;
- Docker running;
- an active local Unix-socket Docker context with no `DOCKER_*` endpoint or
  behavior override;
- `ffmpeg` and `ffprobe` available locally for generation (committed video validation uses
  the exact lockfile-pinned pure-JavaScript MP4 parser); and
- loopback ports `3107`, `39000`, and `55432` free, or three distinct overrides in the
  `KINRESOLVE_LAUNCH_MEDIA_*_PORT` variables.

Do not run the capture from a shell with production credentials. The orchestrator passes
only a small allowlist of non-secret host variables, uses an isolated home and npm cache,
refuses root Next environment files and remote Docker endpoints, supplies fixed synthetic
credentials, and the application guard rejects any Vercel marker, mixed canary mode,
non-loopback origin, non-disposable database path, mismatched build SHA, or missing
acknowledgement. Browser traffic is limited to the exact disposable app origin plus
`POST`/`OPTIONS` requests to the exact loopback MinIO origin and synthetic bucket path used
by the private direct-upload flow; every other origin, storage path, method, and WebSocket is
blocked.

## Capture

Run only after the source changes are committed. The acknowledgements are intentionally
long so a generic local command cannot opt into production-mode HTTP or media capture by
accident.

```bash
export KINRESOLVE_LAUNCH_MEDIA_ORCHESTRATION_ACKNOWLEDGEMENT='I authorize creation and teardown of this exact disposable local launch-media cell.'
node scripts/run-launch-media-capture.mjs
```

The ignored output directory is `output/launch-media/<source-commit>/`. Generation does
not copy anything into the public site. Even a successful run leaves
`REVIEW_REQUIRED.txt` and stops before publication. If the synthetic capture or video
command fails, the terminal receives only a bounded diagnostic with local paths and all
credential-shaped synthetic environment values redacted; production credentials are never
passed into the cell.

## Mandatory human privacy review

Inspect the following at original resolution, not just thumbnails:

1. all eight WebP images;
2. the full video from start to finish with sound and captions;
3. the poster;
4. the WebVTT and transcript;
5. `capture.json`; and
6. the app log only if capture failed.

Confirm all of the following:

- the top bar visibly says `Synthetic demo` in every product frame;
- only Hartwell–Mercer fictional names and the synthetic GEDCOM appear;
- no email, token secret, cookie, password, local path, archive ID, database URL, object
  key, provider ID, terminal, notification, or browser chrome appears;
- API media shows controls or a non-secret prefix only, never the one-time secret;
- no frame implies hosted invitations, real-data publishing, DNA, external AI, binary
  media, billing, or an SLA is live;
- the caption timing and transcript match, and the audio contains only the generated wordless tone bed; and
- the manifest source commit is the exact reviewed capture/source commit and an ancestor of
  the later public asset commit.

If any check fails, discard the whole output directory, fix the source or capture script,
make a new source commit, and capture again. Do not edit a screenshot to conceal a
problem; the public assets must remain regeneratable from their source commit and are accepted
for publication only by their reviewed hashes. Host `ffmpeg`, fonts, and rendering can change,
so byte-for-byte regeneration is not claimed.

## Publish into the site

Only after the review above, run:

```bash
export KINRESOLVE_LAUNCH_MEDIA_PUBLISH_ACKNOWLEDGEMENT='I verified this exact generated package contains only fictional Hartwell-Mercer launch media.'
node scripts/publish-launch-media.mjs <source-commit>
node scripts/validate-launch-media.mjs
```

Commit the generated `site/public/assets/launch/` directory as a second commit. The
validator checks exact schemas and canonical copy, the eight-file sequence, image dimensions
and metadata, file-size bounds, hashes, two-line caption timing, exact transcript, wordless
audio marker, independently probed H.264/AAC streams, and that the source commit is an ancestor
of the asset commit. `site:verify` then checks every public reference in the static export.

## Rollback

The public page and assets are one ordinary code change. Revert that asset/page commit
to remove the tour. If the product is contained or its claims change, also switch the
centralized marketing status and copy according to `docs/unpublish-and-rollback.md`;
removing the video alone is not a complete claim rollback.
