import Link from "next/link";
import { site } from "@/lib/site";

export function CtaStrip({
  eyebrow = "Private beta",
  title = "Bring a real research question to Kin Resolve.",
  body = "We’re looking for family historians willing to test realistic GEDCOM, source, case, publishing, and DNA-triage workflows."
}: {
  eyebrow?: string;
  title?: string;
  body?: string;
}) {
  return (
    <section className="cta-band section-shell" aria-labelledby="cta-title">
      <div>
        <span className="eyebrow eyebrow-light">{eyebrow}</span>
        <h2 id="cta-title">{title}</h2>
        <p>{body}</p>
      </div>
      <div className="cta-actions">
        <Link className="button button-light" href="/beta">Apply for the private beta</Link>
        <a className="button button-ghost-light" href={site.github}>View on GitHub <span aria-hidden="true">↗</span></a>
      </div>
    </section>
  );
}
