import Image from "next/image";
import launchMediaContent from "@/lib/launch-media-content.json";
import { betaStatus } from "@/lib/beta-status";
import { site } from "@/lib/site";

const launchImages = launchMediaContent.captures;
let transcriptCursor = 0;
const transcript = launchMediaContent.segments.map((segment) => {
  const start = transcriptCursor;
  transcriptCursor += segment.durationSeconds;
  return [`${formatTime(start)}–${formatTime(transcriptCursor)}`, segment.text] as const;
});

const assetRoot = "/assets/launch";

export function LaunchMedia() {
  return (
    <section aria-labelledby="launch-tour-heading" className="launch-media section">
      <div className="shell">
        <div className="launch-media-heading">
          <div>
            <span className="eyebrow eyebrow-light">Version-pinned synthetic product tour</span>
            <h2 id="launch-tour-heading">See the working product—without a single real family record.</h2>
          </div>
          <p>
            Eight frames and one exact 90-second walkthrough follow the fictional Hartwell–Mercer archive from question to import, review, evidence, quality, API access, and export.
          </p>
        </div>

        <div className="launch-video-grid">
          <div className="launch-video-frame">
            <video
              aria-label="Ninety-second Kin Resolve synthetic product walkthrough"
              controls
              playsInline
              poster={`${assetRoot}/kin-resolve-private-beta-demo-poster.webp`}
              preload="metadata"
            >
              <source src={`${assetRoot}/kin-resolve-private-beta-demo.mp4`} type="video/mp4" />
              <track
                default
                kind="captions"
                label="English"
                src={`${assetRoot}/kin-resolve-private-beta-demo.vtt`}
                srcLang="en"
              />
              Your browser cannot play the video. Read the transcript below or open the
              <a href={`${assetRoot}/kin-resolve-private-beta-demo.mp4`}> MP4 walkthrough</a>.
            </video>
          </div>
          <aside className="launch-video-note">
            <span className="launch-video-time">1:30</span>
            <h3>Evidence first. Deliberately small.</h3>
            <p>Every screen was captured from an isolated disposable demo cell. Every name, date, place, record, filename, and workflow is fictional.</p>
            <p>Captions are on by default. The audio is a wordless bed generated from mathematical tones; it contains no synthetic or recorded voice.</p>
            <p>{betaStatus.launchMediaDisclaimer}</p>
            <div className="launch-media-links">
              <a href={`${assetRoot}/manifest.json`}>Capture manifest</a>
              <a href={`${assetRoot}/kin-resolve-private-beta-demo-transcript.md`}>Plain-text transcript</a>
              <a href={site.sourceUrl}>Source for this build</a>
            </div>
          </aside>
        </div>

        <details className="launch-transcript">
          <summary>Read the 90-second transcript</summary>
          <ol>
            {transcript.map(([time, text]) => (
              <li key={time}><time>{time}</time><p>{text}</p></li>
            ))}
          </ol>
        </details>

        <div aria-label="Kin Resolve synthetic product tour screenshots" className="launch-gallery" role="list">
          {launchImages.map((image, index) => (
            <figure className="launch-gallery-card" key={image.filename} role="listitem">
              <div className="launch-gallery-image">
                <Image
                  alt={image.alt}
                  height={1000}
                  loading={index < 2 ? "eager" : "lazy"}
                  sizes="(max-width: 760px) 100vw, (max-width: 1100px) 50vw, 42vw"
                  src={`${assetRoot}/${image.filename}`}
                  width={1600}
                />
              </div>
              <figcaption>
                <span>{image.number}</span>
                <div><h3>{image.title}</h3><p>{image.body}</p></div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
