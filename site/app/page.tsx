import Image from "next/image";
import Link from "next/link";
import { CtaStrip } from "@/components/cta-strip";
import { EvidenceBoard } from "@/components/evidence-board";
import { site } from "@/lib/site";

const workflow = [
  {
    number: "01",
    title: "Bring in the record",
    body: "Preview a GEDCOM before applying it, preserve raw references, and keep an export path open."
  },
  {
    number: "02",
    title: "Work the question",
    body: "Organize evidence, hypotheses, and next steps inside a focused research case."
  },
  {
    number: "03",
    title: "Compare the clues",
    body: "Review documentary gaps and DNA matches without treating a suggested relationship as fact."
  },
  {
    number: "04",
    title: "Publish deliberately",
    body: "Check privacy, living status, and publication readiness before a profile becomes public."
  }
] as const;

const capabilities = [
  ["GEDCOM integrity", "Preview imports, review re-import changes, preserve raw records, and export the archive again."],
  ["Research cases", "Keep evidence, hypotheses, confidence, and next actions attached to the question they support."],
  ["Source workspace", "Search source records and transcripts alongside the people and cases that depend on them."],
  ["DNA match triage", "Score and review CSV-imported matches as research leads, then connect the useful ones to a case."],
  ["Quality checks", "Surface date conflicts, privacy risks, source gaps, and profiles that are not ready to share."],
  ["Optional analysis", "Use deterministic checks alone or connect an OpenAI-compatible provider for referenced analysis."]
] as const;

export default function HomePage() {
  return (
    <>
      <section className="home-hero shell">
        <div className="hero-copy">
          <span className="eyebrow">Evidence-led genealogy research</span>
          <h1>Resolve the questions your family tree can’t answer.</h1>
          <p className="hero-lead">
            A family tree captures conclusions. Kin Resolve keeps the evidence trail—records, sources, research cases, DNA clues, and careful analysis—in one private workspace.
          </p>
          <div className="hero-actions">
            <Link className="button" href="/beta">Apply for the private beta</Link>
            <a className="button button-secondary" href={site.github}>View on GitHub <span aria-hidden="true">↗</span></a>
          </div>
          <p className="cta-note">Invitation-only beta. Source available under AGPL-3.0-only.</p>
        </div>
        <EvidenceBoard />
      </section>

      <section className="signal-strip" aria-label="Product principles">
        <div className="shell signal-strip-inner">
          <span><strong>Private</strong> research workspace</span>
          <span><strong>Portable</strong> GEDCOM export</span>
          <span><strong>Open</strong> AGPL source</span>
          <span><strong>Cautious</strong> AI assistance</span>
        </div>
      </section>

      <section className="shell section split-intro">
        <div>
          <span className="eyebrow">The work behind the tree</span>
          <h2>A family tree shows who.<br />Research explains why.</h2>
        </div>
        <div className="prose-large">
          <p>The difficult work lives between the records: conflicting dates, missing sources, uncertain relationships, DNA clues, and questions that remain unresolved.</p>
          <p>Kin Resolve keeps that work connected to the people and evidence it concerns—without smoothing uncertainty into a neat but unsupported answer.</p>
        </div>
      </section>

      <section className="section surface-section">
        <div className="shell">
          <div className="section-heading heading-row">
            <div>
              <span className="eyebrow">A reviewable workflow</span>
              <h2>From imported records to reviewed conclusions.</h2>
            </div>
            <Link className="arrow-link" href="/method">Explore the research method <span aria-hidden="true">→</span></Link>
          </div>
          <div className="workflow-grid">
            {workflow.map((step) => (
              <article className="workflow-card" key={step.number}>
                <span className="step-number">{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="shell section editorial-feature">
        <div className="editorial-image-wrap">
          <Image
            alt="Archival collage tracing a family route from Ireland to Chicago"
            className="editorial-image"
            fill
            priority={false}
            sizes="(max-width: 880px) 100vw, 52vw"
            src="/assets/limerick-chicago.webp"
          />
          <span className="image-caption">Synthetic research story · Limerick to Chicago</span>
        </div>
        <div className="editorial-copy">
          <span className="eyebrow">Follow the trail</span>
          <h2>Keep the question, the clue, and the conclusion together.</h2>
          <p>Research rarely moves in a straight line. A census points to one birthplace, a parish image to another, and a DNA match opens a third branch. Kin Resolve gives that uncertainty a place to live while the work continues.</p>
          <ul className="check-list">
            <li>Separate what a source says from what you infer.</li>
            <li>Record the conflict instead of quietly choosing a favorite.</li>
            <li>Show confidence without presenting a hypothesis as proof.</li>
          </ul>
          <Link className="arrow-link" href="/method">See the method <span aria-hidden="true">→</span></Link>
        </div>
      </section>

      <section className="section capabilities-section">
        <div className="shell">
          <div className="section-heading centered-heading">
            <span className="eyebrow">Current private beta</span>
            <h2>Built for the work behind the tree.</h2>
            <p>Practical research tools are available now. Production hardening and the deeper evidence agent remain visible roadmap work.</p>
          </div>
          <div className="capability-grid">
            {capabilities.map(([title, body], index) => (
              <article className="capability-card" key={title}>
                <span className="capability-index">0{index + 1}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
          <div className="centered-action"><Link className="button button-secondary" href="/product">Explore the product</Link></div>
        </div>
      </section>

      <section className="shell section analyst-section">
        <div className="analyst-copy">
          <span className="eyebrow">Research aid, not authority</span>
          <h2>AI that supports the researcher—not replaces one.</h2>
          <p>Kin Resolve can run structural checks without an AI provider. When an owner connects an OpenAI-compatible provider, the analyst can answer from workspace context, show the references it used, record uncertainty, and stage suggestions for review.</p>
          <p className="disclosure">Provider-backed analysis may send private workspace context to the operator’s configured provider.</p>
          <Link className="arrow-link" href="/privacy">Read the data practices <span aria-hidden="true">→</span></Link>
        </div>
        <div className="analyst-card" aria-label="Illustrative AI analysis with referenced evidence">
          <div className="analyst-card-top">
            <span>Analysis / Case 04</span>
            <span className="preview-pill">Illustrative</span>
          </div>
          <p className="analyst-question">“Which birthplace is better supported?”</p>
          <div className="analyst-answer">
            <strong>The Limerick record is currently stronger.</strong>
            <p>The parish register is closer to the event and names two relatives also present in the Chicago household. The census remains conflicting evidence, not an error to discard.</p>
          </div>
          <div className="reference-row"><span>[R1] Parish register</span><span>[R2] 1901 census</span><span>[D1] Shared match</span></div>
          <div className="analyst-caution"><i aria-hidden="true">!</i> Working analysis. Review source images before changing the tree.</div>
        </div>
      </section>

      <section className="section two-faces-section">
        <div className="shell">
          <div className="section-heading centered-heading narrow-heading">
            <span className="eyebrow">Two deliberate surfaces</span>
            <h2>Private research. Carefully shared family history.</h2>
          </div>
          <div className="faces-grid">
            <article className="face-card face-private">
              <span className="face-kicker">Private workspace</span>
              <h3>Keep the unfinished work private.</h3>
              <p>Imported people, sources, DNA matches, cases, notes, and analysis runs stay behind authenticated workspace access.</p>
              <ul><li>Research cases and hypotheses</li><li>DNA match triage</li><li>Source transcripts and notes</li></ul>
            </article>
            <article className="face-card face-public">
              <span className="face-kicker">Public archive</span>
              <h3>Share only after review.</h3>
              <p>Person-level publication and living-person gates protect the current public archive while more granular controls remain in development.</p>
              <ul><li>Selected ancestor profiles</li><li>Living-person privacy gates</li><li>Publication-readiness review</li></ul>
            </article>
          </div>
        </div>
      </section>

      <section className="shell section status-section">
        <div className="section-heading heading-row">
          <div><span className="eyebrow">Build in public</span><h2>A working beta, with the hardening work visible.</h2></div>
          <a className="arrow-link" href={site.github}>Follow the roadmap <span aria-hidden="true">↗</span></a>
        </div>
        <div className="status-grid">
          <article>
            <span className="status-heading"><i className="status-dot available" aria-hidden="true" /> Available in the current beta</span>
            <ul><li>Single-archive research workspace</li><li>Account-based owner setup</li><li>GEDCOM, cases, sources, DNA, and publishing workflows</li><li>Self-hostable AGPL source</li></ul>
          </article>
          <article>
            <span className="status-heading"><i className="status-dot developing" aria-hidden="true" /> In development</span>
            <ul><li>Multi-archive hosting and family invitations</li><li>Portable object storage and production Compose</li><li>Observability, restore tooling, and durable rate limits</li><li>Stronger citation grounding and conflict workflows</li></ul>
          </article>
        </div>
      </section>

      <div className="shell section"><CtaStrip /></div>
    </>
  );
}
