import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  authenticateApiToken,
  apiTokenInventoryLimits,
  createApiTokenForOwner,
  deriveApiTokenDigest,
  listApiTokensForOwner,
  recordApiTokenExportUse,
  revokeAllApiTokensForOperator,
  revokeApiTokenForOwner,
  type CreatedApiToken
} from "@/lib/beta-api-tokens";
import {
  cleanupExpiredApiRateLimits,
  consumeDurableApiRateLimit
} from "@/lib/durable-api-rate-limit";
import { cleanupExpiredBetaStateForSystem } from "@/lib/beta-invitations";
import { closeDatabasePools } from "@/lib/db";
import { readDatabaseIdentity } from "@/lib/database-attestation";
import { runPendingMigrations } from "@/lib/migrations";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;
const suffix = randomUUID();
const archiveId = `api-token-test-${suffix}`;
const inventoryArchiveId = `api-token-inventory-test-${suffix}`;
const containmentArchiveId = `api-token-containment-test-${suffix}`;
const ownerId = randomUUID();
const viewerId = randomUUID();
const environment = {
  KINRESOLVE_API_V1_ENABLED: "true",
  KINRESOLVE_API_CURSOR_SECRET: "api-token-db-cursor-secret-distinct-and-more-than-32-bytes"
};
const options = { databaseUrl: databaseUrl!, environment };

describeIfDatabase("beta API token database contract", () => {
  const pool = new Pool({ connectionString: databaseUrl!, max: 8 });

  beforeAll(async () => {
    await runPendingMigrations(pool);
    await pool.query(
      `INSERT INTO public.archives (id, name, slug, dataset_mode)
       VALUES
         ($1, 'API token fixture', $1, 'pilot'),
         ($2, 'API token inventory fixture', $2, 'pilot'),
         ($3, 'API token containment fixture', $3, 'pilot')`,
      [archiveId, inventoryArchiveId, containmentArchiveId]
    );
    await pool.query(
      `INSERT INTO public."user" (
         "id", "name", "email", "emailVerified", "createdAt", "updatedAt"
       )
       VALUES
         ($1, 'API Owner', $2, true, now(), now()),
         ($3, 'API Viewer', $4, true, now(), now())`,
      [ownerId, `${ownerId}@example.test`, viewerId, `${viewerId}@example.test`]
    );
    await pool.query(
      `INSERT INTO public.memberships (archive_id, user_id, role)
       VALUES
         ($1, $4, 'owner'), ($1, $5, 'viewer'),
         ($2, $4, 'owner'), ($2, $5, 'owner'), ($3, $4, 'owner')`,
      [archiveId, inventoryArchiveId, containmentArchiveId, ownerId, viewerId]
    );
  });

  afterAll(async () => {
    try {
      // API token and security-event evidence is deliberately append-only for
      // runtime roles. This disposable migration-owner database may reset the
      // complete B5 test surface after all invariants have been exercised.
      await pool.query(
        `TRUNCATE TABLE
           public.api_rate_limit_buckets,
           public.security_events,
           public.api_tokens`
      );
      await pool.query(
        "DELETE FROM public.memberships WHERE archive_id = ANY($1::text[])",
        [[archiveId, inventoryArchiveId, containmentArchiveId]]
      );
      await pool.query('DELETE FROM public."user" WHERE "id" = ANY($1::text[])', [[ownerId, viewerId]]);
      await pool.query(
        "DELETE FROM public.archives WHERE id = ANY($1::text[])",
        [[archiveId, inventoryArchiveId, containmentArchiveId]]
      );
    } finally {
      await pool.end();
      await closeDatabasePools();
    }
  });

  it("provisions stable non-PII API UUIDs and matching archive cursor indexes", async () => {
    const apiIdTables = ["archives", "people", "person_facts", "research_cases", "sources"];
    const columns = await pool.query<{
      table_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string;
    }>(
      `SELECT table_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND column_name = 'api_id'
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [apiIdTables]
    );
    expect(columns.rows).toEqual(apiIdTables.sort().map((tableName) => ({
      table_name: tableName,
      data_type: "uuid",
      is_nullable: "NO",
      column_default: "gen_random_uuid()"
    })));

    const indexes = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef
       FROM pg_catalog.pg_indexes
       WHERE schemaname = 'public'
         AND indexname = ANY($1::text[])
       ORDER BY indexname`,
      [[
        "archives_api_id_unique",
        "people_archive_api_cursor_idx",
        "people_archive_api_id_unique",
        "person_facts_archive_api_id_unique",
        "research_cases_archive_api_cursor_idx",
        "research_cases_archive_api_id_unique",
        "sources_archive_api_cursor_idx",
        "sources_archive_api_id_unique"
      ]]
    );
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual([
      "archives_api_id_unique",
      "people_archive_api_cursor_idx",
      "people_archive_api_id_unique",
      "person_facts_archive_api_id_unique",
      "research_cases_archive_api_cursor_idx",
      "research_cases_archive_api_id_unique",
      "sources_archive_api_cursor_idx",
      "sources_archive_api_id_unique"
    ]);
    for (const { indexname, indexdef } of indexes.rows) {
      if (indexname.endsWith("_cursor_idx")) {
        expect(indexdef).toMatch(/\(archive_id, sort_order, api_id\)$/);
      } else {
        expect(indexdef).toContain("CREATE UNIQUE INDEX");
      }
    }

    await expect(pool.query(
      "UPDATE public.archives SET api_id = gen_random_uuid() WHERE id = $1",
      [archiveId]
    )).rejects.toThrow(/identifiers are immutable/i);
    const deletableArchiveId = `api-id-delete-test-${suffix}`;
    const inserted = await pool.query<{ api_id: string }>(
      `INSERT INTO public.archives (id, name, slug, dataset_mode)
       VALUES ($1, 'API ID deletion fixture', $1, 'pilot')
       RETURNING api_id::text`,
      [deletableArchiveId]
    );
    expect(inserted.rows[0]!.api_id).toMatch(uuidPatternForTest);
    await expect(pool.query("DELETE FROM public.archives WHERE id = $1", [deletableArchiveId]))
      .resolves.toMatchObject({ rowCount: 1 });
  });

  it("creates a 256-bit digest-only token once and exposes only safe metadata later", async () => {
    const token = await createToken(["archive:read", "sources:read"], "Family CLI");
    expect(token.token).toMatch(/^kr_beta_[A-Za-z0-9_-]{43}$/);
    expect(token.prefix).toMatch(/^kr_beta_[A-Za-z0-9_-]{8}$/);
    expect(token.token).not.toBe(token.prefix);
    expect(token.scopes).toEqual(["archive:read", "sources:read"]);

    const stored = await pool.query<{ digest: string; prefix: string }>(
      "SELECT digest, prefix FROM public.api_tokens WHERE id = $1",
      [token.id]
    );
    expect(stored.rows[0]).toEqual({
      digest: deriveApiTokenDigest(token.token),
      prefix: token.prefix
    });
    expect(stored.rows[0]!.digest).not.toContain(token.token);

    const listed = await listApiTokensForOwner({ archiveId, userId: ownerId }, options);
    const metadata = listed.find(({ id }) => id === token.id);
    expect(metadata).toMatchObject({ name: "Family CLI", prefix: token.prefix });
    expect(metadata && "token" in metadata).toBe(false);
    expect(metadata && "digest" in metadata).toBe(false);

    const event = await pool.query(
      `SELECT actor_kind, actor_user_id, event_type
       FROM public.security_events
       WHERE token_id = $1`,
      [token.id]
    );
    expect(event.rows).toEqual([{
      actor_kind: "owner",
      actor_user_id: ownerId,
      event_type: "api-token-created"
    }]);
  });

  it("permits only the current owner to create and list archive-bound tokens", async () => {
    const ownerToken = await createToken(["archive:read"], "Owner boundary");
    await expect(createApiTokenForOwner({
      archiveId,
      userId: viewerId,
      name: "Forbidden",
      scopes: ["archive:read"],
      expiresAt: new Date(Date.now() + 60 * 60_000),
      requestId: randomUUID()
    }, options)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listApiTokensForOwner({ archiveId, userId: viewerId }, options))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(revokeApiTokenForOwner({
      archiveId,
      userId: viewerId,
      tokenId: ownerToken.id,
      requestId: randomUUID()
    }, options)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(revokeApiTokenForOwner({
      archiveId: inventoryArchiveId,
      userId: viewerId,
      tokenId: ownerToken.id,
      requestId: randomUUID()
    }, options)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("bounds concurrent active and lifetime token inventories", { timeout: 15_000 }, async () => {
    const createInventoryToken = (name: string) => createApiTokenForOwner({
      archiveId: inventoryArchiveId,
      userId: ownerId,
      name,
      scopes: ["archive:read"],
      expiresAt: new Date(Date.now() + 60 * 60_000),
      requestId: randomUUID()
    }, options);
    const initialAttempts = await Promise.all(Array.from(
      { length: apiTokenInventoryLimits.active - 1 },
      (_, index) => createInventoryToken(`Concurrent ${index}`)
    ));
    const finalAttempts = await Promise.allSettled([
      createInventoryToken("Final owner one"),
      createApiTokenForOwner({
        archiveId: inventoryArchiveId,
        userId: viewerId,
        name: "Final owner two",
        scopes: ["archive:read"],
        expiresAt: new Date(Date.now() + 60 * 60_000),
        requestId: randomUUID()
      }, options)
    ]);
    const created = [
      ...initialAttempts,
      ...finalAttempts.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])
    ];
    const rejected = finalAttempts.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );
    expect(created).toHaveLength(apiTokenInventoryLimits.active);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ code: "LIMIT_EXCEEDED" });

    const visibleToOtherOwner = await listApiTokensForOwner({
      archiveId: inventoryArchiveId,
      userId: viewerId
    }, options);
    expect(visibleToOtherOwner).toHaveLength(apiTokenInventoryLimits.active);
    expect(visibleToOtherOwner).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created[0]!.id, userId: ownerId })
    ]));
    await revokeApiTokenForOwner({
      archiveId: inventoryArchiveId,
      userId: viewerId,
      tokenId: created[0]!.id,
      requestId: randomUUID()
    }, options);
    await expect(pool.query(
      `SELECT actor_user_id
       FROM public.security_events
       WHERE token_id = $1 AND event_type = 'api-token-revoked'`,
      [created[0]!.id]
    )).resolves.toMatchObject({ rows: [{ actor_user_id: viewerId }] });
    await expect(createInventoryToken("After revoke")).resolves.toMatchObject({
      archiveId: inventoryArchiveId
    });

    await revokeApiTokenForOwner({
      archiveId: inventoryArchiveId,
      userId: ownerId,
      tokenId: created[1]!.id,
      requestId: randomUUID()
    }, options);
    const expired = rawToken();
    await pool.query(
      `INSERT INTO public.api_tokens (
         id, archive_id, user_id, name, prefix, digest, scopes, created_at, expires_at
       )
       VALUES (
         $1, $2, $3, 'Expired inventory fixture', $4, $5, ARRAY['archive:read'],
         clock_timestamp() - interval '2 hours', clock_timestamp() - interval '1 hour'
       )`,
      [
        randomUUID(),
        inventoryArchiveId,
        ownerId,
        expired.slice(0, 16),
        deriveApiTokenDigest(expired)
      ]
    );
    await expect(createInventoryToken("After expiry")).resolves.toMatchObject({
      archiveId: inventoryArchiveId
    });

    const current = await pool.query<{ total: number }>(
      "SELECT count(*)::integer AS total FROM public.api_tokens WHERE archive_id = $1",
      [inventoryArchiveId]
    );
    const fixtureCount = apiTokenInventoryLimits.total - current.rows[0]!.total;
    const fixtures = Array.from({ length: fixtureCount }, (_, index) => {
      const token = rawToken();
      return {
        id: randomUUID(),
        name: `Historical ${index}`,
        prefix: token.slice(0, 16),
        digest: deriveApiTokenDigest(token)
      };
    });
    await pool.query(
      `INSERT INTO public.api_tokens (
         id, archive_id, user_id, name, prefix, digest, scopes, created_at, expires_at
       )
       SELECT fixture.id, $1, $2, fixture.name, fixture.prefix, fixture.digest,
              ARRAY['archive:read'],
              clock_timestamp() - interval '2 hours',
              clock_timestamp() - interval '1 hour'
       FROM unnest($3::text[], $4::text[], $5::text[], $6::text[])
         AS fixture(id, name, prefix, digest)`,
      [
        inventoryArchiveId,
        ownerId,
        fixtures.map(({ id }) => id),
        fixtures.map(({ name }) => name),
        fixtures.map(({ prefix }) => prefix),
        fixtures.map(({ digest }) => digest)
      ]
    );
    await revokeApiTokenForOwner({
      archiveId: inventoryArchiveId,
      userId: ownerId,
      tokenId: created[2]!.id,
      requestId: randomUUID()
    }, options);
    await expect(createInventoryToken("Over lifetime cap"))
      .rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    const finalInventory = await pool.query<{ total: number }>(
      "SELECT count(*)::integer AS total FROM public.api_tokens WHERE archive_id = $1",
      [inventoryArchiveId]
    );
    expect(finalInventory.rows[0]!.total).toBe(apiTokenInventoryLimits.total);
    await expect(listApiTokensForOwner({ archiveId: inventoryArchiveId, userId: ownerId }, options))
      .resolves.toHaveLength(apiTokenInventoryLimits.total);
  });

  it("authenticates by indexed prefix plus constant-time digest and collapses invalid states", async () => {
    const valid = await createToken(["archive:read"], "Valid auth");
    const revoked = await createToken(["archive:read"], "Revoked auth");
    await revokeApiTokenForOwner({
      archiveId,
      userId: ownerId,
      tokenId: revoked.id,
      requestId: randomUUID()
    }, options);

    const expiredToken = rawToken();
    await pool.query(
      `INSERT INTO public.api_tokens (
         id, archive_id, user_id, name, prefix, digest, scopes,
         created_at, expires_at
       )
       VALUES (
         $1, $2, $3, 'Expired auth', $4, $5, ARRAY['archive:read'],
         clock_timestamp() - interval '2 hours', clock_timestamp() - interval '1 hour'
       )`,
      [
        randomUUID(),
        archiveId,
        ownerId,
        expiredToken.slice(0, 16),
        deriveApiTokenDigest(expiredToken)
      ]
    );

    const requestId = randomUUID();
    const happy = await authenticate(valid.token, requestId);
    expect(happy).toMatchObject({
      ok: true,
      context: {
        tokenId: valid.id,
        userId: ownerId,
        archiveId,
        scopes: ["archive:read"],
        requestId,
        rateLimit: { limit: 60, remaining: 59 }
      }
    });
    await expect(authenticateApiToken(
      bearerRequest(valid.token, "/api/v1/meta", "bEaReR  "),
      { scope: "archive:read", routeTemplate: "/api/v1/meta", requestId },
      options
    )).resolves.toMatchObject({ ok: true, context: { tokenId: valid.id } });

    const samePrefixWrongSecret = `${valid.token.slice(0, -1)}${valid.token.endsWith("A") ? "B" : "A"}`;
    const invalidTokens = [
      rawToken(),
      samePrefixWrongSecret,
      expiredToken,
      revoked.token
    ];
    for (const token of invalidTokens) {
      await expect(authenticate(token, requestId)).resolves.toEqual({
        ok: false,
        status: 401,
        code: "invalid_token",
        message: "The bearer token is invalid, expired, or revoked.",
        requestId
      });
    }

    await pool.query(
      "UPDATE public.memberships SET role = 'viewer' WHERE archive_id = $1 AND user_id = $2",
      [archiveId, ownerId]
    );
    try {
      await expect(authenticate(valid.token, requestId)).resolves.toEqual({
        ok: false,
        status: 401,
        code: "invalid_token",
        message: "The bearer token is invalid, expired, or revoked.",
        requestId
      });
    } finally {
      await pool.query(
        "UPDATE public.memberships SET role = 'owner' WHERE archive_id = $1 AND user_id = $2",
        [archiveId, ownerId]
      );
    }

    await pool.query(
      "DELETE FROM public.memberships WHERE archive_id = $1 AND user_id = $2",
      [archiveId, ownerId]
    );
    try {
      await expect(authenticate(valid.token, requestId)).resolves.toEqual({
        ok: false,
        status: 401,
        code: "invalid_token",
        message: "The bearer token is invalid, expired, or revoked.",
        requestId
      });
      await expect(pool.query<{ tokens: number; events: number }>(
        `SELECT
           (SELECT count(*)::integer FROM public.api_tokens WHERE id = $1) AS tokens,
           (SELECT count(*)::integer FROM public.security_events WHERE token_id = $1) AS events`,
        [valid.id]
      )).resolves.toMatchObject({ rows: [{ tokens: 1, events: 1 }] });
    } finally {
      await pool.query(
        `INSERT INTO public.memberships (archive_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [archiveId, ownerId]
      );
    }
  });

  it("charges the route quota before denying a missing scope", async () => {
    const token = await createToken(["sources:read"], "Sources only");
    const result = await authenticateApiToken(
      bearerRequest(token.token, "/api/v1/meta"),
      { scope: "archive:read", routeTemplate: "/api/v1/meta", requestId: randomUUID() },
      options
    );
    expect(result).toMatchObject({
      ok: false,
      status: 403,
      code: "insufficient_scope",
      rateLimit: { limit: 60, remaining: 59 }
    });
    const buckets = await pool.query<{ bucket_kind: string; request_count: number }>(
      `SELECT bucket_kind, request_count
       FROM public.api_rate_limit_buckets
       WHERE token_id = $1
       ORDER BY bucket_kind`,
      [token.id]
    );
    expect(buckets.rows).toEqual([
      { bucket_kind: "standard-day", request_count: 1 },
      { bucket_kind: "standard-minute", request_count: 1 }
    ]);
  });

  it("enforces both standard windows atomically under concurrent requests", async () => {
    const token = await createToken(["archive:read"], "Rate test");
    const results = await Promise.all(Array.from({ length: 61 }, () =>
      consumeDurableApiRateLimit({ tokenId: token.id, profile: "standard" }, { databaseUrl: databaseUrl! })
    ));
    expect(results.filter(({ allowed }) => allowed)).toHaveLength(60);
    expect(results.filter(({ allowed }) => !allowed)).toHaveLength(1);
    const buckets = await pool.query<{ bucket_kind: string; request_count: number }>(
      `SELECT bucket_kind, request_count
       FROM public.api_rate_limit_buckets
       WHERE token_id = $1
       ORDER BY bucket_kind`,
      [token.id]
    );
    expect(buckets.rows).toEqual([
      { bucket_kind: "standard-day", request_count: 60 },
      { bucket_kind: "standard-minute", request_count: 60 }
    ]);
  });

  it("keeps bucket inventory complete when expiry cleanup races acquisition", { timeout: 15_000 }, async () => {
    const token = await createToken(["archive:read"], "Cleanup race");
    await consumeDurableApiRateLimit(
      { tokenId: token.id, profile: "standard" },
      { databaseUrl: databaseUrl! }
    );
    await pool.query(
      `UPDATE public.api_rate_limit_buckets
       SET window_started_at = clock_timestamp() - interval '2 minutes',
           expires_at = clock_timestamp() - interval '1 minute'
       WHERE token_id = $1`,
      [token.id]
    );
    const advisoryLock = 160_017;
    const blocker = await pool.connect();
    let consumePromise: ReturnType<typeof consumeDurableApiRateLimit> | undefined;
    try {
      await pool.query(
        `CREATE FUNCTION public.test_pause_api_rate_limit_acquisition()
         RETURNS trigger
         LANGUAGE plpgsql
         AS $$
         BEGIN
           PERFORM pg_advisory_xact_lock(${advisoryLock});
           RETURN NEW;
         END
         $$`
      );
      await pool.query(
        `CREATE TRIGGER test_pause_api_rate_limit_acquisition
         BEFORE UPDATE ON public.api_rate_limit_buckets
         FOR EACH ROW
         EXECUTE FUNCTION public.test_pause_api_rate_limit_acquisition()`
      );
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock($1)", [advisoryLock]);
      consumePromise = consumeDurableApiRateLimit(
        { tokenId: token.id, profile: "standard" },
        { databaseUrl: databaseUrl! }
      );
      const consumeOutcome = settle(consumePromise);
      await waitForAdvisoryWait(pool, "INSERT INTO public.api_rate_limit_buckets%");
      await expect(cleanupExpiredApiRateLimits(
        { limit: 10 },
        { databaseUrl: databaseUrl! }
      )).resolves.toBe(1);
      await blocker.query("COMMIT");
      await expect(consumeOutcome).resolves.toMatchObject({
        status: "fulfilled",
        value: { allowed: true }
      });
      const buckets = await pool.query<{ bucket_kind: string; request_count: number }>(
        `SELECT bucket_kind, request_count
         FROM public.api_rate_limit_buckets
         WHERE token_id = $1
         ORDER BY bucket_kind`,
        [token.id]
      );
      expect(buckets.rows).toEqual([
        { bucket_kind: "standard-day", request_count: 1 },
        { bucket_kind: "standard-minute", request_count: 1 }
      ]);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await consumePromise?.catch(() => undefined);
      await pool.query("DROP TRIGGER IF EXISTS test_pause_api_rate_limit_acquisition ON public.api_rate_limit_buckets");
      await pool.query("DROP FUNCTION IF EXISTS public.test_pause_api_rate_limit_acquisition()");
    }
  });

  it("serializes parallel full authentication without deadlocks or quota bypass", { timeout: 15_000 }, async () => {
    const token = await createToken(["archive:read"], "Parallel auth");
    const results = await Promise.all(Array.from({ length: 61 }, () =>
      authenticate(token.token, randomUUID())
    ));
    expect(results.filter((result) => result.ok)).toHaveLength(60);
    expect(results.filter((result) => !result.ok && result.code === "rate_limit_exceeded"))
      .toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.code === "service_unavailable"))
      .toHaveLength(0);
    const buckets = await pool.query<{ bucket_kind: string; request_count: number }>(
      `SELECT bucket_kind, request_count
       FROM public.api_rate_limit_buckets
       WHERE token_id = $1
       ORDER BY bucket_kind`,
      [token.id]
    );
    expect(buckets.rows).toEqual([
      { bucket_kind: "standard-day", request_count: 60 },
      { bucket_kind: "standard-minute", request_count: 60 }
    ]);
  });

  it("uses the stricter export quota and records append-only high-sensitivity use", async () => {
    const token = await createToken(["archive:export"], "Export automation");
    const first = await authenticateApiToken(
      bearerRequest(token.token, "/api/v1/exports/gedcom"),
      {
        scope: "archive:export",
        routeTemplate: "/api/v1/exports/gedcom",
        requestId: randomUUID()
      },
      options
    );
    expect(first).toMatchObject({
      ok: true,
      context: { rateLimit: { limit: 1, remaining: 0 } }
    });
    if (!first.ok) throw new Error("Expected export token authentication to succeed.");
    await recordApiTokenExportUse({
      tokenId: first.context.tokenId,
      archiveId: first.context.archiveId,
      userId: first.context.userId,
      requestId: first.context.requestId,
      routeTemplate: "/api/v1/exports/gedcom"
    }, { databaseUrl: databaseUrl! });
    const second = await authenticateApiToken(
      bearerRequest(token.token, "/api/v1/exports/gedcom"),
      {
        scope: "archive:export",
        routeTemplate: "/api/v1/exports/gedcom",
        requestId: randomUUID()
      },
      options
    );
    expect(second).toMatchObject({
      ok: false,
      status: 429,
      code: "rate_limit_exceeded",
      rateLimit: { limit: 1, remaining: 0, retryAfter: expect.any(Number) }
    });
    const event = await pool.query(
      `SELECT actor_kind, actor_user_id, event_type
       FROM public.security_events
       WHERE token_id = $1 AND event_type = 'api-export-used'`,
      [token.id]
    );
    expect(event.rows).toEqual([{
      actor_kind: "token",
      actor_user_id: ownerId,
      event_type: "api-export-used"
    }]);
  });

  it("revokes immediately, preserves evidence, and forbids authority rewrites", async () => {
    const token = await createToken(["archive:read"], "Revocation test");
    const revoked = await revokeApiTokenForOwner({
      archiveId,
      userId: ownerId,
      tokenId: token.id,
      requestId: randomUUID()
    }, options);
    expect(revoked.revokedAt).toBeInstanceOf(Date);
    await expect(authenticate(token.token, randomUUID())).resolves.toMatchObject({
      ok: false,
      status: 401,
      code: "invalid_token"
    });
    await expect(pool.query(
      "UPDATE public.api_tokens SET scopes = ARRAY['archive:export'] WHERE id = $1",
      [token.id]
    )).rejects.toThrow(/immutable/i);
    await expect(pool.query("DELETE FROM public.api_tokens WHERE id = $1", [token.id]))
      .rejects.toThrow(/cannot be deleted/i);
    const eventId = await pool.query<{ id: string }>(
      "SELECT id FROM public.security_events WHERE token_id = $1 LIMIT 1",
      [token.id]
    );
    await expect(pool.query(
      "UPDATE public.security_events SET occurred_at = now() WHERE id = $1",
      [eventId.rows[0]!.id]
    )).rejects.toThrow(/append-only/i);
    const tokenEventFk = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.security_events'::regclass
         AND confrelid = 'public.api_tokens'::regclass`
    );
    expect(tokenEventFk.rows[0]!.total).toBe(0);
  });

  it("revokes all usable tokens atomically while the API flag is disabled", async () => {
    const first = await createToken(["archive:read"], "Containment one");
    const second = await createToken(["sources:read"], "Containment two");
    const requestId = randomUUID();
    const databaseIdentity = await readDatabaseIdentity(pool);
    await expect(revokeAllApiTokensForOperator(
      { archiveId, expectedDatabaseIdentity: "0".repeat(64), requestId },
      { databaseUrl: databaseUrl! }
    )).rejects.toMatchObject({ code: "OPERATION_FAILED" });
    await expect(pool.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM public.api_tokens
       WHERE id = ANY($1::text[]) AND revoked_at IS NULL`,
      [[first.id, second.id]]
    )).resolves.toMatchObject({ rows: [{ total: 2 }] });
    await expect(revokeAllApiTokensForOperator(
      { archiveId, expectedDatabaseIdentity: databaseIdentity.fingerprint, requestId },
      { databaseUrl: databaseUrl! }
    )).resolves.toEqual({ revokedTokens: expect.any(Number) });
    const active = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM public.api_tokens
       WHERE archive_id = $1 AND revoked_at IS NULL AND expires_at > clock_timestamp()`,
      [archiveId]
    );
    expect(active.rows[0]!.total).toBe(0);
    const events = await pool.query(
      `SELECT token_id, actor_kind, actor_user_id
       FROM public.security_events
       WHERE request_id = $1::uuid
       ORDER BY token_id`,
      [requestId]
    );
    expect(events.rows).toEqual(expect.arrayContaining([
      { token_id: first.id, actor_kind: "operator", actor_user_id: null },
      { token_id: second.id, actor_kind: "operator", actor_user_id: null }
    ]));
  });

  it("prevents a concurrent owner creation from surviving revoke-all", { timeout: 15_000 }, async () => {
    await createApiTokenForOwner({
      archiveId: containmentArchiveId,
      userId: ownerId,
      name: "Before containment",
      scopes: ["archive:read"],
      expiresAt: new Date(Date.now() + 60 * 60_000),
      requestId: randomUUID()
    }, options);
    const databaseIdentity = await readDatabaseIdentity(pool);
    const advisoryLock = 160_016;
    const blocker = await pool.connect();
    let revokePromise: ReturnType<typeof revokeAllApiTokensForOperator> | undefined;
    try {
      await pool.query(
        `CREATE FUNCTION public.test_pause_api_token_containment()
         RETURNS trigger
         LANGUAGE plpgsql
         AS $$
         BEGIN
           PERFORM pg_advisory_xact_lock(${advisoryLock});
           RETURN NEW;
         END
         $$`
      );
      await pool.query(
        `CREATE TRIGGER test_pause_api_token_containment
         BEFORE UPDATE ON public.api_tokens
         FOR EACH ROW
         WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
         EXECUTE FUNCTION public.test_pause_api_token_containment()`
      );
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock($1)", [advisoryLock]);

      revokePromise = revokeAllApiTokensForOperator({
        archiveId: containmentArchiveId,
        expectedDatabaseIdentity: databaseIdentity.fingerprint,
        requestId: randomUUID()
      }, { databaseUrl: databaseUrl! });
      const revokeOutcome = settle(revokePromise);
      await waitForAdvisoryWait(pool, "UPDATE public.api_tokens%");
      const createPromise = createApiTokenForOwner({
        archiveId: containmentArchiveId,
        userId: ownerId,
        name: "During containment",
        scopes: ["archive:read"],
        expiresAt: new Date(Date.now() + 60 * 60_000),
        requestId: randomUUID()
      }, options);
      const createOutcome = settle(createPromise);
      await delay(50);
      await blocker.query("COMMIT");
      const [revocation, creation] = await Promise.all([revokeOutcome, createOutcome]);
      expect(revocation).toMatchObject({ status: "fulfilled", value: { revokedTokens: 1 } });
      expect(creation).toMatchObject({
        status: "rejected",
        reason: expect.objectContaining({ code: "OPERATION_FAILED" })
      });
      const active = await pool.query<{ total: number }>(
        `SELECT count(*)::integer AS total
         FROM public.api_tokens
         WHERE archive_id = $1 AND revoked_at IS NULL AND expires_at > clock_timestamp()`,
        [containmentArchiveId]
      );
      expect(active.rows[0]!.total).toBe(0);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await revokePromise?.catch(() => undefined);
      await pool.query("DROP TRIGGER IF EXISTS test_pause_api_token_containment ON public.api_tokens");
      await pool.query("DROP FUNCTION IF EXISTS public.test_pause_api_token_containment()");
    }
  });

  it("provides an archive-confirmed offline containment command with count-only output", async () => {
    const first = await createToken(["archive:read"], "CLI containment one");
    const second = await createToken(["sources:read"], "CLI containment two");
    const databaseIdentity = await readDatabaseIdentity(pool);
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(process.cwd(), "scripts", "revoke-api-tokens.mjs"),
        archiveId,
        `REVOKE ALL API TOKENS FOR ${archiveId}`
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          KINRESOLVE_API_V1_ENABLED: "false",
          KINRESOLVE_DATABASE_IDENTITY: databaseIdentity.fingerprint,
          MIGRATION_DATABASE_URL: databaseUrl!
        }
      }
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ revokedTokens: 2 });
    expect(result.stdout).not.toMatch(/kr_beta_|digest|prefix/i);
    const events = await pool.query(
      `SELECT token_id, actor_kind, actor_user_id
       FROM public.security_events
       WHERE token_id = ANY($1::text[]) AND actor_kind = 'operator'
       ORDER BY token_id`,
      [[first.id, second.id]]
    );
    expect(events.rows).toEqual([
      first.id,
      second.id
    ].sort().map((tokenId) => ({
      token_id: tokenId,
      actor_kind: "operator",
      actor_user_id: null
    })));
  });

  it("cleans expired quota buckets in bounded batches", async () => {
    const token = await createToken(["archive:read"], "Cleanup test");
    await consumeDurableApiRateLimit(
      { tokenId: token.id, profile: "standard" },
      { databaseUrl: databaseUrl! }
    );
    await pool.query(
      `UPDATE public.api_rate_limit_buckets
       SET window_started_at = clock_timestamp() - interval '2 minutes',
           expires_at = clock_timestamp() - interval '1 minute'
       WHERE token_id = $1`,
      [token.id]
    );
    await expect(cleanupExpiredBetaStateForSystem(
      { limit: 1, requestId: randomUUID() },
      {
        archiveId,
        databaseUrl: databaseUrl!,
        privacyHmacSecret: "api-retention-test-secret-distinct-and-over-32-bytes"
      }
    )).resolves.toMatchObject({ expiredApiRateLimits: 1 });
    const remaining = await pool.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM public.api_rate_limit_buckets WHERE token_id = $1",
      [token.id]
    );
    expect(remaining.rows[0]!.total).toBe(1);
  });

  async function createToken(
    scopes: Parameters<typeof createApiTokenForOwner>[0]["scopes"],
    name: string
  ): Promise<CreatedApiToken> {
    return createApiTokenForOwner({
      archiveId,
      userId: ownerId,
      name,
      scopes,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      requestId: randomUUID()
    }, options);
  }

  function authenticate(token: string, requestId: string) {
    return authenticateApiToken(
      bearerRequest(token, "/api/v1/meta"),
      { scope: "archive:read", routeTemplate: "/api/v1/meta", requestId },
      options
    );
  }
});

function bearerRequest(token: string, path: string, scheme = "Bearer"): Request {
  return new Request(`https://app.kinresolve.com${path}`, {
    headers: { authorization: `${scheme} ${token}` }
  });
}

function rawToken(): string {
  return `kr_beta_${randomBytes(32).toString("base64url")}`;
}

const uuidPatternForTest = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function waitForAdvisoryWait(pool: Pool, queryPattern: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const waiting = await pool.query(
      `SELECT 1
       FROM pg_catalog.pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
         AND wait_event_type = 'Lock'
         AND wait_event = 'advisory'
         AND query LIKE $1
       LIMIT 1`,
      [queryPattern]
    );
    if (waiting.rows.length === 1) return;
    await delay(20);
  }
  throw new Error("The containment transaction did not reach the advisory test lock.");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  return promise.then(
    (value) => ({ status: "fulfilled", value }),
    (reason: unknown) => ({ status: "rejected", reason })
  );
}
