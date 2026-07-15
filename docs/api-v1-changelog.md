# Kin Resolve API changelog

This changelog covers the external API at `https://app.kinresolve.com/api/v1`.
Browser-internal `/api/*` routes are not part of this contract.

## Unreleased — v1 Developer Preview candidate

The candidate is implemented behind `KINRESOLVE_API_V1_ENABLED=false` by default. It
must not be described as available until the staged and production launch gates pass.

### Added

- Owner-created, one-time-display API tokens bound to one archive, explicit scopes,
  expiry, revocation state, and current archive ownership.
- Seven GET-only operations for archive metadata, people, sources, cases,
  deterministic quality reporting, and full GEDCOM export.
- Route-and-archive-bound opaque cursor pagination with a default of 25 and maximum
  of 100 records.
- Stable non-content UUID resource surrogates; internal database IDs, GEDCOM xrefs,
  and xref-less NAME values never enter API paths, links, or cursor payloads.
- Stable `{code, message, requestId}` errors and support-safe request IDs.
- Durable per-token minute and daily limits, with stricter GEDCOM export limits.
- OpenAPI 3.1 source, CI registry equality validation, public developer guide, and
  static OpenAPI download.
- Audited creation and use of the separately privileged `archive:export` scope.

### Required provider launch gate

- Configure and verify the provider-side invalid-token flood rule described in the
  [edge rate-limit checklist](api-edge-rate-limit-checklist.md). No live WAF or edge
  protection is asserted by this unreleased repository entry.

### Intentionally not included

- Write operations of any kind.
- Browser CORS or a client-side JavaScript SDK.
- Import/apply/rollback, publishing, DNA, AI, members, settings, token management,
  raw notes, transcripts, files, storage identifiers, or nested evidence graphs.

## Release process

When the launch gates pass, replace the Unreleased heading with the UTC release date
and exact deployed product version. Future entries must identify compatible additions,
deprecations, security changes, and new versioned paths separately.
