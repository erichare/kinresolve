# Kin Resolve API versioning and deprecation policy

Kin Resolve treats the path version as a compatibility promise. The external API
begins at `/api/v1`; browser-internal routes are excluded from this policy.

## Compatible v1 changes

The following can ship without a new path:

- adding an optional response field;
- adding an endpoint;
- adding an optional query parameter;
- adding a new error code under an already documented HTTP status;
- tightening an implementation detail without changing documented behavior; or
- correcting documentation that was more restrictive than the deployed contract.

Clients must ignore unknown response fields and must not infer behavior from response
property order, cursor contents, undocumented headers, or undocumented routes.

## Changes that require a new version

Kin Resolve will use a new versioned path before removing or renaming fields, changing
a field's type or meaning, changing authentication, weakening archive isolation,
changing an existing URL or method, making an optional request value required, or
otherwise breaking a conforming client.

The current and immediately preceding supported versions may run in parallel during
a migration window. A token never gains new scopes implicitly when a version changes.

## Notice and sunset

For a supported version, Kin Resolve aims to provide at least 180 days of notice before
sunset. Notice appears in all of these places:

- the [API changelog](api-v1-changelog.md);
- the public developer page;
- direct email to active beta token owners; and
- `Deprecation`, `Sunset`, and `Link` response headers where technically applicable.

The notice identifies the replacement path, migration guidance, the last supported
date in UTC, and any scope or data-projection differences. After sunset, an intentionally
retired path returns `410 Gone` with the standard safe error envelope for a bounded
transition period.

## Emergency exception

A confirmed security, privacy, legal, or archive-isolation risk can require an immediate
disable or narrower response. Kin Resolve may fence the API or affected operation first,
then notify token owners with the safe detail available. This exception never permits a
silent expansion of data exposure or token authority.

The private-beta preview carries no uptime SLA. Operational rollback does not erase
token audit history, and re-enabling a fenced version requires the normal release and
revocation canaries.
