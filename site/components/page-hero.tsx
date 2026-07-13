import Link from "next/link";
import { site } from "@/lib/site";

export function PageHero({
  eyebrow,
  title,
  lead,
  primary = "Apply for the private beta",
  primaryHref = "/beta",
  showGithub = false,
  note
}: {
  eyebrow: string;
  title: string;
  lead: string;
  primary?: string;
  primaryHref?: string;
  showGithub?: boolean;
  note?: string;
}) {
  const primaryAction = primaryHref.startsWith("http") ? (
    <a className="button" href={primaryHref}>{primary} <span aria-hidden="true">↗</span></a>
  ) : (
    <Link className="button" href={primaryHref}>{primary}</Link>
  );

  return (
    <section className="page-hero shell">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{lead}</p>
      <div className="hero-actions">
        {primaryAction}
        {showGithub && <a className="button button-secondary" href={site.github}>View on GitHub <span aria-hidden="true">↗</span></a>}
      </div>
      {note && <small>{note}</small>}
    </section>
  );
}
