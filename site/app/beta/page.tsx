import Link from "next/link";
import { BetaForm } from "@/components/beta-form";
import { PageHero } from "@/components/page-hero";
import { betaStatus } from "@/lib/beta-status";
import { betaApplicationMode } from "@/lib/beta-application-mode";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Private beta",
  description: betaStatus.metadataDescription,
  path: "/beta/"
});

const faqs = [
  [
    "Is the beta free?",
    `${betaStatus.hostedLive ? "The first" : "The proposed first"} 30-day pilot is free and has no billing or payment-information step. The invitation states the exact participation terms before an account is created.`
  ],
  [
    "When will I get access?",
    betaStatus.hostedLive
      ? "Invitations are issued privately to approved participants. Applying records interest but does not create an account, guarantee access, or place you in an automatic queue. Cohorts remain deliberately small."
      : "Invitations have not started. Applying records interest but does not create an account, guarantee access, or place you in an automatic queue. Cohorts will remain deliberately small after the launch gates pass."
  ],
  [
    `What file can ${betaStatus.hostedLive ? "the pilot" : "the proposed pilot"} accept?`,
    "Plain .ged or .gedcom only, initially limited to 10 MiB (10,485,760 bytes) and 40,000 people. Source work is limited to metadata, links, and pasted text or transcripts."
  ],
  [
    "Can I upload family data?",
    "Not when applying. Every participant starts with synthetic records. One isolated plain-GEDCOM pilot may accept real family data only after the legal, restore, deletion, recovery, and security gates pass."
  ],
  [
    "Can I use DNA, external AI, media, or public publishing?",
    "No. DNA, external-provider AI, binary source attachments, media packages, and real-data public publishing are disabled for cohort one."
  ],
  [
    `What support ${betaStatus.hostedLive ? "does the pilot target" : "is proposed"}?`,
    "Founder-operated onboarding and a one-business-day support acknowledgement target, with weekly check-ins and announced maintenance. This is a target, not an uptime or response-time SLA."
  ],
  [
    "What am I agreeing to when I apply?",
    betaStatus.hostedLive
      ? "Only to receive beta communications. Applying is not acceptance of beta participation terms. An invitation presents the approved, published participation terms, privacy notice, and cohort boundary for explicit acceptance."
      : "Only to receive beta communications. Applying is not acceptance of beta participation terms. An invitation can be accepted only after the approved participation terms, privacy notice, and cohort boundary are published and presented for explicit acceptance."
  ],
  [
    "Can I self-host?",
    "The AGPL source is available now. The current Compose path is suitable for development and beta evaluation while production hardening continues."
  ]
] as const;

const cohortIncluded = [
  "An invitation-only private archive for one researcher or trusted household",
  "Reviewable plain-GEDCOM import, apply, rollback, and full GEDCOM export",
  "People, sources, cases, evidence, hypotheses, tasks, and deterministic checks",
  betaStatus.apiLive
    ? "A read-only, owner-scoped API preview for approved archive owners"
    : "A read-only, owner-scoped API preview only after its separate gate passes"
] as const;

const excluded = [
  "DNA files or match triage",
  "External-provider AI",
  "Binary source images, ZIPs, or media packages",
  "Real-data public publishing, open signup, billing, or shared multi-family hosting"
] as const;

const operatingBoundary = [
  "Synthetic records first; real data only after every applicable gate",
  "One isolated real-data cell, not a shared multi-tenant service",
  "Operator-assisted export and deletion",
  "No uptime SLA or guarantee of zero data loss"
] as const;

export default function BetaPage() {
  return (
    <>
      <PageHero
        eyebrow={betaStatus.badge}
        lead={`${betaStatus.summary} We’re prioritizing family historians and genealogists with rigorous source, GEDCOM, and case workflows—and the patience to give detailed feedback.`}
        note="Applying does not create an account, accept participation terms, or authorize family-data submission."
        primary="Start the application"
        primaryHref="#apply"
        title="Help shape a more rigorous genealogy research workspace."
      />

      <section className="shell section beta-fit-grid" data-beta-status-surface="beta">
        <div>
          <span className="eyebrow">A strong fit</span>
          <h2>You have a research process to test—not just a feature list.</h2>
        </div>
        <div className="fit-cards">
          <article><strong>Bring</strong><p>An unresolved question and a workflow you know well. Do not send records with the application.</p></article>
          <article><strong>Expect</strong><p>{betaStatus.headline} {betaStatus.rollout} Applying does not guarantee access.</p></article>
          <article><strong>Protect</strong><p>Living people and sensitive data. The application itself should contain no family records.</p></article>
        </div>
      </section>

      <section className="section surface-section">
        <div className="shell status-table-wrap">
          <div className="section-heading">
            <span className="eyebrow">{betaStatus.hostedLive ? "Hosted cohort-one contract" : "Proposed cohort-one contract"}</span>
            <h2>Small by design, with the difficult boundaries stated upfront.</h2>
            <p>{betaStatus.hostedLive ? "These are the active launch limits for approved participants under the published cohort boundary and recorded operational evidence." : "These are the intended launch limits, pending owner approval, counsel-reviewed documents, and recorded operational evidence."}</p>
          </div>
          <div className="status-table">
            <div className="status-column">
              <span className="status-heading"><i className="status-dot available" /> {betaStatus.hostedLive ? "Included" : "Proposed to include"}</span>
              <ul>{cohortIncluded.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
            <div className="status-column">
              <span className="status-heading"><i className="status-dot exploring" /> Excluded</span>
              <ul>{excluded.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
            <div className="status-column">
              <span className="status-heading"><i className="status-dot developing" /> Operating boundary</span>
              <ul>{operatingBoundary.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          </div>
        </div>
      </section>

      <section className="shell section privacy-roadmap">
        <div className="section-heading">
          <span className="eyebrow">From application to archive</span>
          <h2>An application is not an invitation—and an invitation is not permission to skip the gates.</h2>
        </div>
        <ol>
          <li><strong>Apply without records</strong><span>Send only the fixed contact and workflow fields shown below. There is no free-text field or file upload.</span></li>
          <li><strong>Private selection</strong><span>A founder reviews fit and capacity. There is no automatic account creation or guaranteed placement.</span></li>
          <li><strong>Review exact documents</strong><span>Before account creation, an invite presents the approved participation terms, privacy notice, and cohort boundary for explicit acceptance.</span></li>
          <li><strong>Start synthetic</strong><span>Use fictional Hartwell–Mercer data first. Real family data remains prohibited until every real-data gate is approved and evidenced.</span></li>
        </ol>
      </section>

      <section className="section surface-section" id="apply">
        <div className="shell application-grid">
          <div className="application-intro">
            <span className="eyebrow">Beta interest</span>
            <h2>Tell us about the work you want to test.</h2>
            <p>{betaApplicationMode === "application" ? "The active no-JavaScript form posts fixed, minimal fields to the product application endpoint. The marketing site remains static and does not store the submission." : `The fallback intake opens a prepared email addressed to ${site.betaEmail}. The marketing site does not store your submission.`}</p>
            <p>Submitting consents only to beta communications. It does not accept participation terms or authorize Kin Resolve to receive family records. Read the current <Link href="/privacy">data-practices disclosure</Link> before applying.</p>
            <div className="application-boundary">
              <strong>Please do not submit</strong>
              <span>GEDCOM files, DNA results, relatives’ or other living people’s names or details, source images, credentials, or private family details.</span>
            </div>
          </div>
          <BetaForm />
        </div>
      </section>

      <section className="shell section practice-note">
        <strong>Use the right contact route—and keep private evidence out of email.</strong>
        <p><a href={`mailto:${site.betaEmail}`}>{site.betaEmail}</a> is for applications and cohort communication. Participant support {betaStatus.hostedLive ? "uses" : "will use"} <a href="mailto:support@kinresolve.com">support@kinresolve.com</a>; private vulnerability reports {betaStatus.hostedLive ? "use" : "will use"} <a href="mailto:security@kinresolve.com">security@kinresolve.com</a>. {betaStatus.hostedLive ? "Those routes are delivery-tested for the hosted cohort." : "The support and security routes must be delivery-tested before invitations begin."}</p>
        <p>Do not email family records, GEDCOM files, screenshots of private research, credentials, API tokens, or genetic information. A private transfer route must be arranged if evidence bytes are genuinely necessary.</p>
      </section>

      <section className="shell section faq-section">
        <div className="section-heading"><span className="eyebrow">Questions before applying</span><h2>Small cohorts, clear boundaries.</h2></div>
        <div className="faq-list">{faqs.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div>
      </section>
    </>
  );
}
