# Private-beta legal document handoff

- **Status:** Operational draft for owner and counsel review
- **Updated:** 2026-07-15
- **Legal effect:** None
- **Source of product truth:** [`hosted-beta-contract.md`](hosted-beta-contract.md)

This document turns the implemented invitation and legal-byte validation perimeter into
a concrete review and publication checklist. It is not legal advice, participation
terms, a privacy notice, counsel approval, or permission to accept real family data.
Do not publish this file as a legal document and do not copy generic internet terms into
production merely to satisfy the release manifest.

## Required approved artifacts

The first invitation cannot be accepted until all three artifacts exist as final,
versioned, immutable bytes on `https://kinresolve.com`:

| Artifact | Proposed versioned public path | Purpose | Current status |
| --- | --- | --- | --- |
| Private-beta participation terms | `/legal/private-beta-participation-terms-v1.*` | Participation, acceptable use, beta risk, support, suspension, termination, ownership, and liability terms | Not drafted or approved in this repository |
| Private-beta privacy notice | `/legal/private-beta-privacy-notice-v1.*` | Data categories, purposes, providers, retention, rights, security, incident contact, and deletion treatment | Not drafted or approved in this repository |
| Cohort-one boundary | `/legal/cohort-one-boundary-v1.*` | Exact enabled/excluded capabilities, admitted content, pilot topology, limits, and support posture | Engineering proposal exists; owner/counsel approval pending |

The extension can be `.html`, `.md`, `.txt`, or `.pdf` only if the release validator
accepts its exact media type. The URL must be HTTPS on `kinresolve.com`, contain no query
or fragment, and never redirect. A new document version gets a new path and digest;
approved bytes are never edited in place.

For each artifact, the protected release manifest records the approved version,
versioned `https://kinresolve.com` URL, and lowercase SHA-256 digest of the published
response bytes.

## Application consent is not participation consent

The static marketing source has two explicit build modes. The default `mailto` mode
opens a prepared message and stores no form submission on the marketing site; the
applicant's provider, Kin Resolve mail routing, and the receiving mailbox handle any
message they choose to send. The `application` mode must not be activated until its
product endpoint, database grants, Resend delivery, retention cleanup, and operator
deletion evidence pass. In that mode, a credentialless native form posts only name,
email, fixed researcher/workflow/archive-size/tool categories, and exact consent to the
product service. It accepts no free text or files and stores no IP address, user agent,
cookie, Authorization header, or family data. The product stores every application row
for no more than 90 days and sends a receipt plus a founder notification through Resend.

The checkbox in either mode means only consent to receive Kin Resolve beta
communications. The application-mode consent version is exactly
`beta-communications-v1`; it does not grant broader data-processing or participation
authority.

That consent must not be described or stored as acceptance of hosted participation
terms, the privacy notice, data processing, family-data upload, API terms, or a place in
the cohort. An applicant becomes a participant only after a bound invitation presents
all three verified documents and records explicit exact-version acceptance before
account creation.

## Product facts counsel should review

The approved documents should be written against these current cohort-one facts, not a
future broad SaaS design:

- invitation-only, proposed free 30-day pilot; no open signup, billing, or payment data;
- one researcher or trusted household in one isolated deployment/database/object-store
  cell; no shared multi-family tenancy;
- synthetic Hartwell–Mercer records first;
- one real plain-GEDCOM pilot only after every real-data gate passes;
- `.ged` or `.gedcom` only, up to 10 MiB (10,485,760 bytes) and 40,000 people;
- source metadata, links, and pasted text/transcripts only;
- DNA, external-provider AI, binary evidence, media packages, real-data public
  publishing, open signup, and billing disabled at server boundaries;
- owner-scoped, read-only API preview only after its separate launch gate;
- founder-operated onboarding, export, deletion, and support;
- proposed one-business-day support acknowledgement target, weekly check-in, announced
  maintenance, and no uptime SLA; and
- no claim of GDPR, CCPA, HIPAA, genetic-privacy, or other regulatory compliance.

Any approved deviation must be recorded in the hosted-beta contract and implemented in
the runtime/release contracts before the legal document is published.

## Participation-terms decision checklist

Counsel and the product owner should decide and write, at minimum:

- contracting entity, governing contact, effective date, eligibility, and any age or
  authority-to-upload requirement;
- the pilot period, whether participation is free, and an explicit statement that no
  payment information is collected;
- the exact permitted data and prohibited data/capabilities;
- the participant's responsibility to have authority to submit information about other
  people, especially living relatives;
- confidentiality expectations and the ban on sending records, credentials, or tokens
  through ordinary email or public issues;
- acceptable use, credential safety, API use, rate limits, and prohibition on attempts
  to cross archive or provider boundaries;
- participant ownership of uploaded research and the narrow service license required
  to store, process, back up, export, and delete it;
- feedback rights without claiming ownership of the participant's family research;
- beta limitations, no uptime SLA, maintenance, feature changes, suspension, incident
  containment, and termination;
- export opportunity, access cutoff, operator-assisted deletion, retained-backup
  expiry, and any minimal non-content legal receipt;
- warranty, liability, indemnity, dispute, jurisdiction, and statutory-rights language
  authored for the actual entity and participant locations; and
- support, security, legal, and formal-notice routes.

Engineering should not invent the last item set or silently encode it from a template.

## Privacy-notice decision checklist

The approved notice should identify:

1. **Who is responsible.** The actual entity/controller/business identity and contact.
2. **Who is covered.** Applicants, invited participants, account holders, relatives
   described in submitted genealogy, support correspondents, and API users.
3. **Data categories.** Application contact/workflow fields; account and acceptance
   evidence; archive people, relationships, facts, sources, transcripts, cases, and
   tasks; GEDCOM artifacts; API token metadata/security events; operational metadata;
   support requests; database/object backups. DNA and external-AI data are excluded.
4. **Purposes and legal bases.** These require counsel and jurisdiction-specific review;
   product necessity, consent, legitimate interest, or contract must not be guessed by
   engineering.
5. **Provider inventory.** Applicant email provider, Cloudflare mail routing, Vercel,
   Supabase, Resend, the selected encrypted off-provider backup destination, the selected
   observability provider, and any support/status provider actually used at launch.
6. **Regions and transfers.** Actual configured storage/processing regions and approved
   transfer mechanism, not provider marketing defaults.
7. **Security practices.** Isolation topology, authenticated membership, capability
   gates, encrypted transport, private object storage, credential separation, bounded
   telemetry, recovery evidence, and incident response without guaranteeing security.
8. **Retention.** Approved schedules for applications, invitations, accounts, archive
   data, staged/import artifacts, transactional email, logs, audit/security evidence,
   support cases, provider backups, and encrypted off-provider backups.
9. **Export, correction, and deletion.** GEDCOM plus structured research export,
   authenticated deletion request, whole-cell teardown, retained-backup expiry, and the
   distinction between a request, access cutoff, primary deletion, and completed expiry.
10. **Automated decisions and AI.** External-provider AI is disabled for cohort one;
    deterministic checks support researcher review and do not decide legal rights.
11. **Children, deceased people, and living relatives.** Counsel must decide the
    applicable notice/authority posture for relational genealogy data.
12. **Rights and complaints.** Exact jurisdiction-dependent rights, verification,
    response routes, appeal/complaint contacts, and non-discrimination language where
    applicable.
13. **Changes.** Versioning, notice, and an explicit re-consent rule when a material
    change cannot rely on the earlier acceptance.

## Retention values awaiting approval and proof

These are engineering planning targets, not promises:

| Data class | Planning target | Missing authority/evidence |
| --- | --- | --- |
| Every product beta-application record | Delete 90 days after submission, or earlier after a verified request | Owner/counsel approval; bounded database cleanup, signed operator deletion, and transactional-email/provider lifecycle proof |
| Direct GEDCOM staging | Bounded cleanup after 24 hours | Production scheduled-run evidence |
| Operational events/logs | 14 days | Provider selection/configuration and expiry proof |
| Non-content security/audit evidence | 90 days, except records required through cell teardown | Counsel decision per record class and provider/database enforcement |
| Primary real-pilot data | Teardown within seven days after verified request and optional export | Approved promise, complete provider teardown tool/process, rehearsal |
| Retained backups after primary deletion | Expire no later than 30 days afterward | Provider and off-provider lifecycle configuration plus expiry rehearsal |

If the approved values differ, update code, workflows, runbooks, marketing, and tests
before publishing the legal document. Do not make the legal document promise behavior
the system cannot prove.

## Publication and release procedure

1. Counsel supplies final bytes and a change summary through the approved private route.
2. Product owner, privacy/legal reviewer, and launch owner approve the same bytes and
   version. Record approval outside the public repository.
3. Publish once at the exact versioned `kinresolve.com` URL. Disable mutable CMS
   transforms, personalization, redirects, and consent banners that change the bytes.
4. Fetch the public file with redirects disabled. Confirm HTTP 200, allowlisted media
   type, body at or below 2 MiB, and no placeholder names, dates, providers, or terms.
5. Hash the raw response bytes with SHA-256. Do not hash a local draft and assume the
   published response is identical.
6. Put only status, version, URL, and lowercase digest into the protected staging and
   production environments. Never put document text into environment variables.
7. Run the release legal-byte validator in staging and production. A mismatch blocks
   release; do not update the expected digest without repeating approval.
8. Exercise an invitation with a synthetic address. Verify the legal viewer serves the
   exact bytes, acceptance is required before account creation, and the audit record
   contains the exact three versions/digests.
9. Independently verify the public marketing page still calls itself a data-practices
   page and does not imply that applying accepted these documents.
10. Record the final release SHA, document versions/digests, approvers, workflow run,
    and UTC publication time in the private launch record.

## Change and withdrawal rules

- Correcting a typo changes bytes and therefore requires a new version/digest.
- Existing acceptance evidence is immutable. Do not rewrite it to the newest version.
- A required re-consent needs a product flow that blocks only at the reviewed boundary;
  it cannot be simulated by changing environment metadata.
- If any approved document becomes unavailable, redirects, or changes bytes, pause new
  invitations. Existing participant access follows the approved policy and incident
  decision; do not guess.
- Unpublishing the product does not complete deletion or terminate the legal/backup
  lifecycle. Follow the export/deletion and containment runbooks.

## Final approval record

Leave this table pending in source. The authoritative approval record belongs in the
private launch vault and is referenced here only by privacy-safe identifier after
approval.

| Role | Artifact/version | Private approval record ID | Date | Status |
| --- | --- | --- | --- | --- |
| Product owner | All three | — | — | Pending |
| Privacy/legal reviewer | All three | — | — | Pending |
| Engineering | Behavior/manifest match | — | — | Pending |
| Launch owner | Published bytes and release evidence | — | — | Pending |
