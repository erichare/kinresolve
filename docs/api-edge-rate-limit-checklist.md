# API v1 edge rate-limit launch checklist

Status: **required and not yet evidenced**. This repository defines the application
contract; it does not prove the current state of a DNS, CDN, WAF, or hosting provider.
Do not enable `KINRESOLVE_API_V1_ENABLED=true` in production or publish API-availability
wording until this checklist has a current evidence packet and release-owner sign-off.

The protected `api-edge-evidence` workflow now produces the required provider receipt,
but the workflow definition is not itself evidence. Only a successful, current,
release-SHA-bound run whose sole JSON artifact and GitHub attestation pass the production
release gate changes this status for that release.

## Control objective

Reject abusive missing-token and malformed-token traffic for `/api/v1/*` before it can
amplify origin concurrency or database token lookups. This control supplements—never
replaces—the atomic 60/minute and 10,000/day application buckets, the stricter export
buckets, token revocation, and archive authorization.

The edge control must not:

- record or reflect an `Authorization` value;
- forward a token into analytics, request samples, support events, or rule labels;
- create a route or method outside the checked-in OpenAPI and runtime registry;
- bypass authentication for an allowlisted caller;
- weaken the response, archive-isolation, cache, or TLS boundary; or
- be described as active based only on a proposed rule, screenshot mockup, local test,
  DNS record, or repository configuration.

## Configuration review

Record each item in the launch evidence packet. Secret values and raw client addresses
do not belong in the packet.

- [ ] Production provider account, zone/project, and protected hostname are confirmed.
- [ ] Rule matches the exact `app.kinresolve.com` host and `/api/v1/*` path before origin.
- [ ] Every method is covered; unsupported methods still fail closed.
- [ ] Threshold, window, burst behavior, key, action, and recovery period are written
  down with a staging load-test rationale. No threshold is assumed by this document.
- [ ] Provider logging and sampled-request settings log no request header except the
  non-secret `x-request-id`; query values are excluded, and retention and access owners
  are recorded.
- [ ] The response is non-cacheable and does not reflect the token, address, query,
  provider internals, or archive details.
- [ ] The rule does not trust a caller-supplied forwarding header as its rate key.
- [ ] There is no permanent participant or operator bypass. Time-bounded test bypasses,
  if unavoidable, have an owner, expiry, and separate removal proof.
- [ ] Origin access controls prevent a public alternate hostname from bypassing the rule.
- [ ] Rule changes require the same protected production approval as API enablement.

## Protected Vercel evidence workflow

The repository workflow [`.github/workflows/api-edge-evidence.yml`](../.github/workflows/api-edge-evidence.yml)
is intentionally read-only. It performs authenticated `GET` requests against Vercel's
active firewall configuration and system-bypass endpoints; it cannot create, publish,
patch, disable, or delete a rule. Configure or change the rule separately under the
normal protected production change process.

Configure a GitHub environment named `api-edge-evidence` with required reviewers and
deployment branch protection restricted to `main`. Give it only this secret:

- `VERCEL_TOKEN`: a read-only Vercel token able to inspect the protected project.

Set these protected environment variables:

- `VERCEL_PROJECT_ID` and `VERCEL_ORG_ID`: the exact production project/team IDs;
- `VERCEL_DIRECT_ORIGIN`: a generated `https://*.vercel.app` deployment URL covered by
  Vercel Deployment Protection;
- `API_EDGE_RULE_ID`: the immutable expected custom-rule ID;
- `API_EDGE_EXPECTED_LIMIT`: an integer from 1 through 60, keeping the proof burst
  bounded;
- `API_EDGE_EXPECTED_WINDOW_SECONDS`: an integer from 10 through 600; and
- `API_EDGE_EXPECTED_ACTION`: exactly `rate_limit`. The beta proof requires Vercel's
  default `429` follow-up; the `deny` action returns `403` and is intentionally rejected.

The active Vercel rule must be valid and enabled, use one AND group containing exactly
`host equals app.kinresolve.com` and `path starts with /api/v1/`, use a fixed window,
and key only on Vercel's provider-derived `ip`. The active firewall and every active
custom rule may log no request header except `x-request-id`; this rejects cookies,
bearer credentials, Vercel protection bypasses, operator signatures, and unknown
future credential headers. No active custom-rule bypass,
IP bypass, system-protection bypass, project bypass, or domain bypass is accepted.

Dispatch the workflow from `main` with the exact current 40-character main SHA. Enter
these two acknowledgements byte-for-byte:

```text
I inspected Vercel Firewall logs and confirmed only x-request-id is logged; credentials, cookies, bypass headers, signatures, and query values are not logged or sampled.
```

```text
I confirm the active Kin Resolve API edge rule and direct-origin protection were approved through the protected production change process.
```

The protected reviewer must compare the proposed threshold to the staging results and
inspect provider logs before approving the run. The workflow then:

1. proves the dispatch SHA is exactly current `origin/main`;
2. reads the currently active provider configuration and a bounded system-bypass page,
   failing closed if the provider returns 100 entries or any continuation cursor;
3. validates the exact rule before sending traffic;
4. sends exactly `limit + 2` unauthenticated `/api/v1/meta` requests from one runner,
   with a harmless per-run marker query, requiring an ordinary `401`/`404` followed by
   at least one `429`;
5. requires the protected direct Vercel origin to return `401` or `403` plus Vercel's
   non-application HTML deployment-protection page without a deployment bypass
   credential (an application JSON `invalid_token` response fails this proof);
6. bounds and inspects every response header and body, rejects marker reflection,
   credentials, provider project/team IDs, and positive shared-cache freshness, and
   requires an explicit private/no-store policy for the otherwise heuristically
   cacheable canonical response. Canonical API responses also reject redirects and
   cookies; the separate Vercel Authentication denial may use its provider-owned
   login redirect/cookie mechanics, but none of those raw headers leave the runner;
7. emits one sanitized `api-edge-evidence.json`, valid for 24 hours and containing only
   hashes, rule/configuration identifiers and revision, counts, statuses, and times;
7. attests that JSON with GitHub Artifact Attestations and uploads only that file.

No API token is sent by this proof. Raw provider responses and response bodies remain in
the permission-restricted runner directory and are deleted on every outcome. The JSON
contains a SHA-256 of the Vercel project ID and direct origin rather than either raw value.

Before production promotion, fetch both Vercel endpoints again and run:

```bash
node --experimental-strip-types scripts/validate-api-edge-evidence.mjs api-edge-evidence.json
node --experimental-strip-types scripts/verify-live-api-edge-config.mjs \
  api-edge-evidence.json active-firewall.json system-bypasses.json
```

The first command requires `RELEASE_COMMIT`, `GITHUB_REPOSITORY`, `API_EDGE_RUN_ID`, and
`API_EDGE_RUN_ATTEMPT`. The second needs no credentials or environment variables. It
fails if the complete active-configuration checksum, configuration revision, exact rule,
or bypass state changed after attestation. Never pass `VERCEL_TOKEN` to either command.

Vercel documents that WAF rate-limit counters are regional. A fixed-window rule can
therefore admit more than the nominal threshold across several regions; this single-runner
proof demonstrates enforcement in one region and does not claim a global hard ceiling.
Record that limitation in the launch decision. See Vercel's [rate-limiting semantics](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting),
[active firewall configuration API](https://vercel.com/docs/rest-api/security/read-firewall-configuration),
and [system bypass API](https://vercel.com/docs/rest-api/security/read-system-bypass).

## Staging proof

Run against an isolated custom staging origin bound to the exact release candidate SHA.
Use a generated secret environment variable; never put a token in a command argument,
URL, fixture, recording, or evidence output.

- [ ] A normal authenticated `/meta` request succeeds below the edge threshold.
- [ ] Missing-token, malformed-token, and random-token bursts are limited before origin
  token lookup at the documented threshold.
- [ ] Parallel bursts cannot exceed the configured edge burst allowance.
- [ ] A valid token still encounters the durable application minute and daily buckets.
- [ ] GEDCOM export still encounters the separate 1/minute and 10/day buckets.
- [ ] Unsupported routes and methods remain `404`/`405` through the same edge path.
- [ ] Response and provider logs were inspected for token, query, archive, and person-data
  leakage; evidence contains only counts, status classes, route templates, and timestamps.
- [ ] Disabling the rule restores the expected staging path, and re-enabling it restores
  protection without changing application configuration.

## Production canary evidence

API-launch mode creates one ephemeral `archive:read` token through the protected
migration connection for the exact expected archive owner. Its secret exists only in a
mode-`0600` runner file. Use it only for `/meta` on the exact candidate and canonical
origin, revoke it, and prove the next canonical call is `401`. Do not create or read a
fictional person in the production pilot cell. Do not upload the token, response body,
owner/archive identity, runner-local metadata, or provider logs as evidence. The
retained token, quota, and security rows are bounded non-content release evidence and
consume one lifetime-token inventory slot.

- [ ] Exact production deployment SHA and immutable artifact identity are recorded.
- [ ] Provider rule ID, revision/version, configuration export checksum, activation UTC,
  and approving owner are recorded.
- [ ] A bounded missing-token probe demonstrates the rule without becoming an abusive
  test; origin telemetry proves requests did not amplify database token lookup.
- [ ] A valid canary request succeeds and emits only approved privacy-safe telemetry.
- [ ] Canary token revocation is immediate; the next request receives `401`.
- [ ] Provider log redaction and retention were inspected in the production account.
- [ ] Alternate-origin and direct-provider-hostname bypass checks fail closed.
- [ ] Evidence is attached to the release record, and the rule is independently reviewed.

## Rollback

If the edge rule blocks legitimate beta traffic, set `KINRESOLVE_API_V1_ENABLED=false`
first, confirm the API fails closed, and revoke operational/beta tokens as the incident
requires. Then disable or correct the provider rule under production approval. Keep
application migrations and security events for audit. Re-enable only after staging and
production canaries pass again; do not trade away invalid-token flood protection to
restore availability.
