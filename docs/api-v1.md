# Kin Resolve API v1 Developer Preview

Kin Resolve exposes a deliberately small, read-only API for invited private-beta
archives. The API is intended for trusted command-line tools and server-side
integrations. It is not a browser SDK, and cross-origin browser access is not enabled.

- Base URL: `https://app.kinresolve.com/api/v1`
- Contract: [`openapi/kinresolve-v1.yaml`](../openapi/kinresolve-v1.yaml)
- Public developer page: `https://kinresolve.com/developers/`
- Public OpenAPI download: `https://kinresolve.com/openapi/kinresolve-v1.yaml`
- Changelog: [`docs/api-v1-changelog.md`](api-v1-changelog.md)
- Deprecation policy: [`docs/api-deprecation-policy.md`](api-deprecation-policy.md)

The preview is activated archive by archive. The token controls described below are
visible only when API v1 is enabled for an invited archive.

## Quickstart

An archive owner creates a token in **Settings → Developer API**. Select the smallest
set of scopes the integration needs and a short expiry. The complete token is shown
once; Kin Resolve stores only a digest and a short non-secret display prefix.

Put the token in an environment variable. Do not paste it into source code, shell
history, a URL, client-side JavaScript, screenshots, analytics, or support messages.

```bash
read -rsp "Kin Resolve API token: " KINRESOLVE_TOKEN && export KINRESOLVE_TOKEN
printf '\n'

curl --fail-with-body \
  -H "Authorization: Bearer $KINRESOLVE_TOKEN" \
  https://app.kinresolve.com/api/v1/meta
```

List the first 25 people:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $KINRESOLVE_TOKEN" \
  "https://app.kinresolve.com/api/v1/people?limit=25"
```

When `page.nextCursor` is not `null`, pass it back unchanged:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $KINRESOLVE_TOKEN" \
  "https://app.kinresolve.com/api/v1/people?limit=25&cursor=$NEXT_CURSOR"
```

Revoke the token in **Settings → Developer API** when the integration no longer needs
it. Revocation applies to the next request. A revoked token cannot be restored.

## Authentication and archive isolation

Every request uses the standard bearer header:

```http
Authorization: Bearer $KINRESOLVE_TOKEN
```

Each token is bound to exactly one user and one archive, plus explicit scopes, an
expiry, and revocation state. Requests never choose an archive through a path, query,
or header. Kin Resolve verifies that the token's user is still the current archive
owner on every request. Missing, malformed, expired, revoked, and otherwise invalid
tokens intentionally receive the same `401` shape.

The API returns private archive data. Treat API responses with the same care as the
archive itself. Responses use `Cache-Control: private, no-store, max-age=0` and must
not be placed in shared caches.

## Scopes

| Scope | Grants | Does not grant |
| --- | --- | --- |
| `archive:read` | Archive metadata, people pages, and bounded person facts | Sources, cases, reports, exports, or any mutation |
| `sources:read` | Conservative source summaries | Transcripts, notes, files, blob keys, download URLs, or mutations |
| `cases:read` | Bounded case summaries | Nested evidence, hypotheses, tasks, or mutations |
| `reports:read` | Deterministic aggregate quality checks | Names, record bodies, provider-backed AI, or mutations |
| `archive:export` | Full GEDCOM export | Any mutation; this high-sensitivity owner-only scope is separately confirmed and audited |

Create separate short-lived tokens for unrelated integrations. Do not give a reporting
job `archive:export`, and do not reuse an export token for routine reads.

## Endpoints

| Method and path | Scope | Response |
| --- | --- | --- |
| `GET /meta` | `archive:read` | API version, product version, archive display metadata, and capabilities |
| `GET /people` | `archive:read` | Cursor page of conservative person summaries |
| `GET /people/{id}` | `archive:read` | One person and at most 100 structured facts |
| `GET /sources` | `sources:read` | Cursor page without transcripts, files, or storage identifiers |
| `GET /cases` | `cases:read` | Cursor page without a nested evidence graph |
| `GET /reports/quality` | `reports:read` | Aggregate deterministic summary and checks |
| `GET /exports/gedcom` | `archive:export` | Audited, non-cacheable GEDCOM 5.5.1 attachment |

No write operation is part of v1. Import, apply, rollback, publishing, DNA, AI, member,
token-management, and settings endpoints are not exposed. An undocumented v1 route or
method fails closed.

Resource IDs are stable, non-content UUID surrogates. Internal database IDs, GEDCOM
xrefs, and xref-less NAME values never enter API response IDs, cursors, links, or
request paths. Pass the returned value unchanged to `/people/{id}`; do not infer or
rebuild it.

## Pagination

The three collection endpoints accept only `limit` and `cursor`.

- `limit` defaults to 25 and must be an integer from 1 through 100.
- `cursor` is opaque and is bound to the route and archive that issued it.
- Copy the cursor exactly. Do not decode, edit, persist indefinitely, or use it with
  another endpoint or archive.
- A final page returns `{"page":{"nextCursor":null}}`.

Page shape:

```json
{
  "data": [],
  "page": {
    "nextCursor": null
  }
}
```

Single-resource and report responses use a `data` envelope as well. `GET /meta`
returns `apiVersion`, `productVersion`, `archive`, and `capabilities` inside `data`;
`GET /people/{id}` returns the person projection inside `data`.

Collection pagination is weakly consistent while an archive is changing. A concurrent
import, restore, or edit can move a record across page boundaries, so clients may see a
duplicate or miss a record during that traversal. Clients must identify and de-duplicate
records by `id`, and restart from the first page when they need a fresh complete view.
Adding fields is a compatible change; clients should ignore unknown response fields.

## Errors and request IDs

JSON errors always use the same flat, safe envelope:

```json
{
  "code": "invalid_request",
  "message": "The request is invalid.",
  "requestId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
}
```

| Status | Typical code | Meaning |
| --- | --- | --- |
| `400` | `invalid_request` | Unsupported query parameter, invalid limit, or invalid cursor |
| `401` | `invalid_token` | Missing or unusable bearer token; token-state details are not disclosed |
| `403` | `insufficient_scope` | Valid token without the required scope |
| `404` | `not_found` or `api_disabled` | Resource is not in the token's archive, or the preview is disabled; cross-archive existence is not disclosed |
| `405` | `method_not_allowed` | The path exists but the method is not registered |
| `429` | `rate_limit_exceeded` | A durable minute or daily bucket is exhausted |
| `503` | `service_unavailable` | API configuration or a required dependency is temporarily unavailable |
| `500` | `internal_error` | Safe internal failure without archive or implementation detail |

Every response includes `X-Request-Id`. Include that identifier—not the token or a
private response body—when asking support to investigate a failed request.

## Limits and retries

Standard read operations allow 60 requests per minute and 10,000 per day per token.
The high-sensitivity GEDCOM export allows 1 request per minute and 10 per day per token.
Both minute and daily durable buckets apply; parallel requests cannot bypass them.
An authenticated request consumes the route's quota before scope authorization, so a
valid under-scoped token cannot send unbounded denied requests.

Responses report `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` for
the currently effective window. A `429` also includes `Retry-After`. Wait for that
interval and retry with exponential backoff and jitter. Do not retry `400`, `401`,
`403`, or `404` automatically.

Production availability also requires a separately configured and verified edge rule
that limits invalid-token floods before they amplify origin or database work. Repository
code does not prove that provider-side control is active. Operators must complete the
[edge rate-limit launch checklist](api-edge-rate-limit-checklist.md) and attach current
provider evidence before enabling API availability wording. That protective limit is
not a participant quota and can be tuned without changing the per-token contract.

## Credential and security-evidence lifecycle

API token digests, non-secret prefixes, scope/expiry/revocation metadata, and API
security events are protected evidence for the lifetime of their isolated archive cell.
A cell can hold at most 10 currently usable tokens and 100 token records over its
lifetime. Creation is serialized under the archive/member lock, and exceeding either
inventory returns a conflict without creating a token or event. The lifetime token cap,
maximum token expiry, export quotas, and one-way revocation bound application-created
append-only security-event growth; ordinary rows still are not deleted piecemeal.
A row-level synthetic-demo reset first requires every usable API token to be revoked and
then preserves those token and event rows; it does not claim that the database is empty.
Durable minute/day rate buckets are short-lived mutable state and are removed by bounded
expiry cleanup or by the isolated demo reset.

Authoritative deletion of retained API token and security-event evidence is destruction
of the whole isolated data cell under the approved deletion/recovery procedure, not an
ordinary row delete. This describes the implemented lifecycle only. It does not set or
claim an approved production retention period; owner and counsel approval is still
required before a duration appears in launch, legal, or data-practices copy.

## GEDCOM export

`archive:export` is deliberately separate from read scopes. An owner must explicitly
confirm it at token creation, and both creation and use are recorded as high-sensitivity
security events. Download to a protected file and remove it according to the archive's
retention policy.

```bash
umask 077
curl --fail-with-body \
  -H "Authorization: Bearer $KINRESOLVE_TOKEN" \
  -o kinresolve-export.ged \
  https://app.kinresolve.com/api/v1/exports/gedcom
```

## Versioning and support

The version is part of the URL. Breaking changes require a new versioned path; v1 is
not changed in place. Compatible additions can include new optional response fields,
new endpoints, or new optional query parameters. See the
[deprecation policy](api-deprecation-policy.md) for notice and sunset rules.

This is a Developer Preview for invited participants, not a general-availability or
uptime-SLA commitment. Report a problem to `beta@kinresolve.com` with the timestamp,
route template, HTTP status, and request ID. Never send a token, private record, query
value, person name, source text, or response body in the first message.

## Operator rollback

Operators can disable the entire surface with `KINRESOLVE_API_V1_ENABLED=false` and
revoke all beta tokens without removing audit records or migrations. The offline
containment command requires protected `MIGRATION_DATABASE_URL`, the attested
`KINRESOLVE_DATABASE_IDENTITY`, the exact archive ID, and the archive-bound phrase:

```sh
npm run api:tokens:revoke-all -- \
  "$KINSLEUTH_ARCHIVE_ID" \
  "REVOKE ALL API TOKENS FOR $KINSLEUTH_ARCHIVE_ID"
```

It works while the API flag is false, never auto-migrates, and prints only the number of
revoked tokens. Marketing must not claim API availability until token creation, archive
isolation, limits, OpenAPI validation, staged canaries, production canaries, and
immediate revocation proof pass.
