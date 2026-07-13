import { CtaStrip } from "@/components/cta-strip";
import { PageHero } from "@/components/page-hero";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata({
  title: "Product",
  description: "Explore the GEDCOM, source, research-case, DNA-triage, analysis, and publishing workflows in Kin Resolve.",
  path: "/product/"
});

const productAreas = [
  {
    number: "01",
    eyebrow: "Archive integrity",
    title: "Import without flattening the record.",
    body: "Preview a GEDCOM before it changes the archive. Kin Resolve preserves raw records, xrefs, custom tags, notes, source references, and checksums, then shows reviewable changes on re-import.",
    points: ["Preview before apply", "Reviewable re-import differences", "Pre-import recovery snapshot", "Full GEDCOM 5.5.1 export"],
    example: { label: "Import review", title: "riemer-family-2026.ged", rows: [["New people", "42"], ["Changed records", "7"], ["Removed records", "0"]] }
  },
  {
    number: "02",
    eyebrow: "Focused research",
    title: "Work a question, not just a person.",
    body: "Cases hold the question, evidence, hypotheses, confidence, and next actions together. The tree remains a record of conclusions; the case preserves how you got there.",
    points: ["Evidence linked to people and sources", "Competing hypotheses", "Confidence and rationale", "Reviewable next-step queue"],
    example: { label: "Active case", title: "Riemer immigration to Chicago", rows: [["Evidence items", "8"], ["Hypotheses", "3"], ["Open tasks", "5"]] }
  },
  {
    number: "03",
    eyebrow: "Sources in context",
    title: "Keep citations close to the work they support.",
    body: "Search source records and transcripts, connect them to people and cases, and make gaps visible before a conclusion or public profile is treated as finished.",
    points: ["Source register and search", "Transcripts and archive details", "Person and case links", "Coverage-gap reporting"],
    example: { label: "Source review", title: "St. Michael parish register", rows: [["Linked people", "4"], ["Linked cases", "2"], ["Transcript", "Reviewed"]] }
  },
  {
    number: "04",
    eyebrow: "DNA as a clue",
    title: "Triage matches without turning a score into a fact.",
    body: "Import match CSVs, rank the most useful leads, record shared-match context, and connect promising matches to a research case. Suggested ranges remain hypotheses for human review.",
    points: ["CSV import and match scoring", "Surname and place clues", "Shared-match context", "Case evidence links"],
    example: { label: "DNA lead", title: "Match KR-014", rows: [["Shared DNA", "86 cM"], ["Tree", "Public"], ["Likely range", "3C–4C"]] }
  },
  {
    number: "05",
    eyebrow: "Optional analysis",
    title: "Use AI as an analyst, not an authority.",
    body: "Deterministic structural checks work without an AI key. An operator can optionally connect an OpenAI-compatible provider for workspace-grounded answers, referenced context, uncertainty, and staged suggestions.",
    points: ["No-key structural checks", "Operator-selected provider", "Referenced workspace context", "Saved runs and staged suggestions"],
    example: { label: "Analysis run", title: "Birthplace conflict", rows: [["Context records", "6"], ["References", "4"], ["Confidence", "Moderate"]] }
  },
  {
    number: "06",
    eyebrow: "Deliberate publishing",
    title: "Review before sharing.",
    body: "The current beta combines manual person publication with living-person and privacy gates. Publication-readiness checks surface blockers and gaps while more granular fact-level controls are developed.",
    points: ["Manual person publication", "Living and privacy gates", "Readiness blockers", "Anonymous public profiles"],
    example: { label: "Publishing review", title: "Mary Ann Zajicek", rows: [["Privacy", "Pass"], ["Living status", "Pass"], ["Source gaps", "2"]] }
  }
] as const;

export default function ProductPage() {
  return (
    <>
      <PageHero
        eyebrow="The product"
        lead="Connect imported records to questions, sources, DNA clues, analysis, and publishing decisions—without turning a working hypothesis into a fact."
        showGithub
        title="One workspace for the work behind the tree."
      />

      <section className="shell product-intro-grid section">
        <div><span className="eyebrow">A connected workspace</span><h2>The research trail stays attached.</h2></div>
        <p className="prose-large">People, sources, cases, matches, and analysis are useful on their own. They become far more useful when you can see which question each item informs—and what remains uncertain.</p>
      </section>

      <section className="product-areas section">
        <div className="shell">
          {productAreas.map((area, index) => (
            <article className={`product-area ${index % 2 ? "product-area-reverse" : ""}`} key={area.number}>
              <div className="product-area-copy">
                <span className="eyebrow">{area.number} / {area.eyebrow}</span>
                <h2>{area.title}</h2>
                <p>{area.body}</p>
                <ul className="check-list">{area.points.map((point) => <li key={point}>{point}</li>)}</ul>
              </div>
              <div className="mini-workspace" aria-label={`Illustrative ${area.example.label} panel`}>
                <div className="mini-workspace-top"><span>{area.example.label}</span><i aria-hidden="true" /></div>
                <h3>{area.example.title}</h3>
                <div className="mini-rows">
                  {area.example.rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
                </div>
                <div className="mini-workspace-foot">Illustrative interface</div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section surface-section">
        <div className="shell status-table-wrap">
          <div className="section-heading"><span className="eyebrow">Product status</span><h2>Clear about what exists—and what does not yet.</h2></div>
          <div className="status-table">
            <div className="status-column"><span className="status-heading"><i className="status-dot available" /> Available</span><ul><li>Single-archive private workspace</li><li>GEDCOM import, review, and export</li><li>Cases, sources, DNA triage, and reports</li><li>Optional provider-backed analysis</li><li>Person-level publication gates</li></ul></div>
            <div className="status-column"><span className="status-heading"><i className="status-dot developing" /> In development</span><ul><li>Multi-archive hosted tenancy</li><li>Invitations and family collaboration</li><li>Portable object storage</li><li>Granular publication controls</li><li>Observability and restore workflows</li></ul></div>
            <div className="status-column"><span className="status-heading"><i className="status-dot exploring" /> Exploring</span><ul><li>Grounded GPS research agent</li><li>Semantic evidence retrieval</li><li>Agent-assisted record search</li><li>Pedigree, timeline, and map views</li></ul></div>
          </div>
          <p className="status-footnote">“Exploring” describes roadmap direction, not a shipping commitment. Follow progress in the <a href="https://github.com/erichare/kinresolve">public repository</a>.</p>
        </div>
      </section>

      <div className="shell section"><CtaStrip title="Test the research workflow—not a polished fiction." body="Bring a realistic question and tell us where the import, evidence, case, DNA, or publishing flow breaks down." /></div>
    </>
  );
}
