import Link from "next/link";
import { Icons } from "@/components/icons";
import { PublicShell } from "@/components/public-shell";

export default function KinSleuthProductPage() {
  return (
    <PublicShell active="/kinsleuth">
      <div className="page-wrap">
        <section className="product-hero section" style={{ paddingTop: 72 }}>
          <h1>KinSleuth</h1>
          <p>Self-hosted software for genealogists who need more than a tree viewer: private investigations, GEDCOM provenance, DNA match triage, and AI-assisted evidence analysis.</p>
          <div className="hero-actions">
            <Link className="button" href="/app">
              <Icons.FileSearch size={17} aria-hidden />
              Open demo workspace
            </Link>
            <Link className="button-secondary" href="https://github.com/">
              MIT open source
            </Link>
          </div>
        </section>

        <section className="section grid-3">
          {[
            ["Import without losing provenance", "Preserve raw GEDCOM records, custom tags, Ancestry IDs, source URLs, notes, and media references."],
            ["Turn matches into hypotheses", "Rank useful DNA matches and explain likely branch, generation, geography, evidence, and uncertainty."],
            ["Publish only what you approve", "Keep living people, private cases, DNA data, and sensitive facts hidden until curated for public viewing."]
          ].map(([title, body]) => (
            <div className="panel" key={title}>
              <h2>{title}</h2>
              <p>{body}</p>
            </div>
          ))}
        </section>

        <section className="section grid-2">
          <div className="panel">
            <h2>Self-hosted runtime</h2>
            <p>Docker Compose starts the app, Postgres with pgvector, object storage, and a worker. Each deployment represents one family archive.</p>
            <pre style={{ overflow: "auto", background: "#10201b", color: "#f7f8f5", padding: 18, borderRadius: 8 }}>docker compose up --build</pre>
          </div>
          <div className="panel">
            <h2>AI on your terms</h2>
            <p>OpenAI-compatible provider settings let an owner/admin connect hosted or local-compatible models. Whole-tree analysis is role-gated and audited.</p>
          </div>
        </section>
      </div>
    </PublicShell>
  );
}

