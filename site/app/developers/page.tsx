import { CtaStrip } from "@/components/cta-strip";
import { PageHero } from "@/components/page-hero";
import { betaStatus } from "@/lib/beta-status";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Developers",
  description: "Build trusted, read-only tools for one Kin Resolve archive with scoped tokens, bounded projections, cursor pagination, and an OpenAPI 3.1 contract.",
  path: "/developers/"
});

const endpoints = [
  ["archive:read", "GET /meta", "Version, archive display metadata, and capabilities"],
  ["archive:read", "GET /people", "Bounded cursor pages of conservative person summaries"],
  ["archive:read", "GET /people/{id}", "One person with at most 100 structured facts"],
  ["sources:read", "GET /sources", "Source summaries without files, transcripts, or storage keys"],
  ["cases:read", "GET /cases", "Case summaries without nested evidence graphs"],
  ["reports:read", "GET /reports/quality", "Deterministic aggregate quality checks"],
  ["archive:export", "GET /exports/gedcom", "Audited full GEDCOM 5.5.1 export"]
] as const;

const principles = [
  {
    number: "01",
    title: "One token, one archive",
    body: "Tokens are owner-created, expire, revoke immediately, and never choose an archive from caller input."
  },
  {
    number: "02",
    title: "Least privilege by default",
    body: "People, sources, cases, reports, and full export have explicit scopes. No v1 operation writes archive state."
  },
  {
    number: "03",
    title: "A contract you can test",
    body: "The OpenAPI 3.1 document is checked against the runtime route registry in CI and published from the same source."
  }
] as const;

export default function DevelopersPage() {
  return (
    <>
      <PageHero
        eyebrow="API v1 · Developer Preview"
        lead="Build trusted command-line and server-side tools around people, sources, cases, deterministic quality checks, and portable GEDCOM export—without opening the browser application’s internal API."
        note={betaStatus.apiLive
          ? "API v1 is available only to approved private-beta participants for archives they own. Tokens remain owner-created, scoped, expiring, and revocable. Browser CORS is intentionally disabled."
          : betaStatus.hostedLive
            ? "The hosted private beta is live for approved participants, but API v1 is not available in this release. Its separate edge-rate-limit, production, and revocation evidence gates remain mandatory. Browser CORS is intentionally disabled."
            : "The contract is implemented in source. Hosted access stays disabled until the SHA-bound staging, edge-rate-limit, production, and revocation gates pass, then activates archive by archive for invited participants. Browser CORS is intentionally disabled."
        }
        primary="Download OpenAPI 3.1"
        primaryHref={`${site.url}/openapi/kinresolve-v1.yaml`}
        showGithub
        title="A small API with a serious privacy boundary."
      />

      <section className="shell developer-principles section" aria-label="API design principles">
        {principles.map((principle) => (
          <article key={principle.number}>
            <span>{principle.number}</span>
            <h2>{principle.title}</h2>
            <p>{principle.body}</p>
          </article>
        ))}
      </section>

      <section className="section developer-quickstart">
        <div className="shell developer-quickstart-grid">
          <div>
            <span className="eyebrow eyebrow-light">Quickstart</span>
            <h2>From token to first response in one request.</h2>
            <p>{betaStatus.apiLive ? "An approved archive owner creates" : "After hosted API activation, an archive owner creates"} a short-lived token in Settings and selects only the scopes an integration needs. The complete secret is displayed once.</p>
            <div className="developer-callouts">
              <span><strong>Base URL</strong> app.kinresolve.com/api/v1</span>
              <span><strong>Page size</strong> 25 default · 100 maximum</span>
              <span><strong>Errors</strong> code · message · requestId</span>
            </div>
          </div>
          <div className="terminal-card developer-terminal" aria-label="cURL request to Kin Resolve API metadata">
            <div className="terminal-top"><span /><span /><span /><small>Terminal · trusted environment</small></div>
            <pre><code><span>$</span> curl --fail-with-body \{"\n"}  -H &quot;Authorization: Bearer $KINRESOLVE_TOKEN&quot; \{"\n"}  https://app.kinresolve.com/api/v1/meta</code></pre>
            <div className="developer-terminal-response"><small>{betaStatus.apiLive ? "Illustrative approved-archive 200 response" : "Illustrative 200 response after activation"} · excerpt</small><pre tabIndex={0} aria-label="Illustrative API metadata response"><code>{`{
  "data": {
    "apiVersion": "v1",
    "archive": {
      "name": "Hartwell–Mercer Family Archive"
    }
  }
}`}</code></pre></div>
          </div>
        </div>
      </section>

      <section className="shell section developer-contract">
        <div className="developer-contract-heading">
          <div><span className="eyebrow">The launch contract</span><h2>Seven reads. No surprise authority.</h2></div>
          <p>Every endpoint is registered explicitly. Unknown routes and methods fail closed; import, apply, rollback, publishing, DNA, AI, members, settings, and token management stay outside the external contract.</p>
        </div>
        <div className="developer-endpoints" role="table" aria-label="API v1 endpoints and required scopes">
          <div className="developer-endpoint-header" role="row">
            <span role="columnheader">Scope</span><span role="columnheader">Operation</span><span role="columnheader">Projection</span>
          </div>
          {endpoints.map(([scope, operation, description]) => (
            <div className="developer-endpoint" role="row" key={operation}>
              <span role="cell"><i aria-hidden="true" />{scope}</span>
              <code role="cell">{operation}</code>
              <p role="cell">{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section surface-section">
        <div className="shell developer-operations">
          <article>
            <span className="eyebrow">Bounded by design</span>
            <h2>Opaque cursors, non-content IDs.</h2>
            <p>Collection responses include <code>data</code> and <code>page.nextCursor</code>. Stable UUID surrogates keep internal database IDs, GEDCOM xrefs, and xref-less names out of paths and cursor logs. Cursors are signed to their route and archive. Source files, transcripts, notes, blob keys, private download URLs, and unbounded evidence graphs are never part of these projections.</p>
          </article>
          <article className="developer-rate-card">
            <span>Standard reads</span><strong>60</strong><small>requests / minute</small><b>10,000 / day</b>
          </article>
          <article className="developer-rate-card developer-rate-card-export">
            <span>GEDCOM export</span><strong>1</strong><small>request / minute</small><b>10 / day</b>
          </article>
        </div>
      </section>

      <section className="shell section developer-notes" id="preview-terms">
        <article>
          <span className="eyebrow">Versioning</span>
          <h2>Breaking means a new path.</h2>
          <p>Compatible additions can land in v1. Removing a field, changing its meaning, changing authentication, or otherwise breaking a conforming client requires a new versioned path. Kin Resolve aims to give supported versions at least 180 days of sunset notice.</p>
          <a className="arrow-link" href={`${site.github}/blob/main/docs/api-deprecation-policy.md`}>Read the deprecation policy <span aria-hidden="true">↗</span></a>
        </article>
        <article>
          <span className="eyebrow">Developer Preview terms</span>
          <h2>Private data deserves deliberate tooling.</h2>
          <p>The preview is invitation-only and carries no uptime SLA. Keep tokens in trusted server or command-line environments, minimize scopes and expiry, honor archive retention rules, and revoke access when work ends. Never include tokens or private response bodies in support requests.</p>
          <a className="arrow-link" href={`${site.github}/blob/main/docs/api-v1.md`}>Read the complete developer guide <span aria-hidden="true">↗</span></a>
        </article>
        <article>
          <span className="eyebrow">Changelog</span>
          <h2>Contract changes stay visible.</h2>
          <p>{betaStatus.apiLive ? "API v1 is released as an invitation-only Developer Preview for approved participants and archives they own." : "The initial v1 contract remains an unreleased candidate until staging, production, archive-isolation, rate-limit, and immediate-revocation gates pass."} Release notes distinguish additions, deprecations, security changes, and intentional exclusions.</p>
          <a className="arrow-link" href={`${site.github}/blob/main/docs/api-v1-changelog.md`}>Read the API changelog <span aria-hidden="true">↗</span></a>
        </article>
      </section>

      <div className="shell section">
        <CtaStrip
          body="Tell us what you want to build, which archive projections you need, and how you protect private family-history data."
          eyebrow="Developer Preview"
          primaryHref="/beta"
          primaryLabel="Apply for private-beta access"
          secondaryHref={`${site.url}/openapi/kinresolve-v1.yaml`}
          secondaryLabel="Download OpenAPI 3.1"
          title="Bring one careful integration to the first cohort."
        />
      </div>
    </>
  );
}
