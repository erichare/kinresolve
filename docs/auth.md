# Identity, invitations, and account recovery

_Status: hosted private-beta identity perimeter implemented; live provider and legal approvals remain release gates._

Kin Resolve uses Better Auth with the repository's versioned PostgreSQL migrations. Hosted identity is invitation-only. Self-hosted first-run setup remains a separate, explicit path.

## Hosted account boundary

A hosted account can reach a private archive only when all of these are true:

- the Better Auth session is valid;
- the account email is verified;
- a membership exists for the deployment-selected archive;
- the membership is backed by a consumed, email-bound invitation; and
- the membership is backed by immutable clickwrap evidence for the exact participation terms, privacy notice, and cohort boundary approved at onboarding, including version, URL, and SHA-256 digest.

Open signup and both implicit owner paths are disabled in hosted mode. Creating a Better Auth account directly, racing first-run setup, or becoming the earliest account does not confer archive access.

## Invitation acceptance

Migration `014_beta_invitations.sql` adds the paused-by-default invitation control, invitations, stateful email-verification capabilities, append-only legal acceptance and redacted identity evidence, operator replay protection, and durable authentication-rate-limit buckets.

Invitation bearer values are 256-bit random capabilities. Only SHA-256 digests are stored. Invitations are single-use, expire on the database clock, and bind archive, email, role, purpose, and the exact approved legal manifest.

The acceptance service performs a cheap database preflight before password hashing or outbound legal checks. It then fetches and hashes all three approved documents, and finally repeats every check under a row lock in the account-creation transaction. The transaction creates the user, credential account, membership, legal acceptance, and stateful verification capability while consuming the invitation. Any failure rolls the whole transaction back.

An approved legal-manifest update invalidates outstanding invitations but does not silently lock out participants who accepted an earlier approved version. Any policy that requires existing participants to re-consent needs a dedicated, explicit re-consent flow before that version becomes an access requirement.

Browser action links carry capabilities only in URL fragments. The client reads the exact fragment, removes it from browser history immediately, and submits it in a bounded same-origin JSON request. Tokens never appear in query strings or token-bearing `GET` requests.

The legal links shown during acceptance use `/api/beta/legal/*`. The server re-fetches the allowlisted `kinresolve.com` document, rejects redirects, streams no more than 2 MiB, verifies the configured digest, and serves only those verified bytes in a sandboxed, no-store response. Acceptance performs its own fresh verification immediately before the transaction.

## Operator workflow

The public runtime contains only an Ed25519 public key. The private key belongs in the operator environment and must not be stored in Vercel project variables, the repository, shell history, or command arguments.

The client requires:

- `KINRESOLVE_BETA_OPERATOR_BASE_URL`
- `KINRESOLVE_BETA_OPERATOR_AUDIENCE`
- `KINRESOLVE_BETA_OPERATOR_KEY_ID`
- `KINRESOLVE_BETA_OPERATOR_PRIVATE_KEY_PKCS8`

The base URL and audience must be the same canonical HTTPS origin. Every command signs the audience, method, path, exact body, timestamp, UUID nonce, and key ID. The runtime verifies that signature and atomically consumes the nonce before applying the command, preventing cross-cell and same-cell replay.

The invitation control begins paused. A typical first-owner sequence is:

```bash
npm run beta:operator -- control active operator
npm run beta:operator -- issue participant@example.com owner initial-owner 86400
```

Operational containment is explicit:

```bash
npm run beta:operator -- control paused incident
npm run beta:operator -- revoke-all
npm run beta:operator -- cleanup 250
```

The CLI sends requests only to `/api/operator/invitations`, never connects to production PostgreSQL, never prints the participant email or private key, does not retry mutations, and allowlists its output fields.

## Verification and recovery

Hosted sign-in requires a verified email. Verification capabilities are random, hashed at rest, single-use, account/invitation-bound, and revocable. Reissue responses are fixed and perform all account-dependent database and email-provider work after the response so an address cannot be enumerated through response content or timing.

Password reset uses Better Auth's hashed verification identifiers, a 30-minute expiry, and revokes all sessions on completion. Reset links use fragments rather than query strings. Forgot-password responses are generic, hosted credential endpoints accept only bounded JSON, and durable HMAC-keyed limits cover client address plus email or reset-token subjects. No raw email, address, or capability is stored in a rate-limit key.

Transactional messages use the exact `APP_BASE_URL`, fixed templates, no family data, provider idempotency keys, and a verified `beta@kinresolve.com` sender through Resend. Provider failures are contained and redacted; no provider error body, API key, email address, or capability is logged or returned.

Account settings provide a deliberate “sign out all sessions” control. Password recovery revokes every session automatically. The browser never receives Better Auth's raw session-token list.

## Self-hosted behavior

Self-hosted deployments preserve first-run `/setup`, optional unverified sign-in, and the deterministic earliest-account owner self-heal while the archive has no members. Hosted-only invitation, legal, and outbound-email requirements do not silently change those defaults.

## Release requirements

Production release validation requires:

- hosted deployment mode and `KINRESOLVE_ALLOW_SIGNUPS=false` (legacy `KINSLEUTH_ALLOW_SIGNUPS` accepted during the rename compatibility window);
- a separate `KINRESOLVE_BETA_PRIVACY_HMAC_SECRET`;
- the operator audience, key ID, and Ed25519 public key;
- the approved legal status plus exact version, URL, and digest for all three documents;
- `KINRESOLVE_TRANSACTIONAL_EMAIL_PROVIDER=resend`;
- the approved sender and reply-to address; and
- `RESEND_API_KEY` as a sensitive runtime value.

The release workflow validates the legal bytes after pulling each staging and production environment contract. Real participant data remains prohibited until owner and counsel approve those external documents and the rest of the hosted launch gates pass.
