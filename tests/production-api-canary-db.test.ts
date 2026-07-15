import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  authenticateApiToken,
  createApiTokenForOwner,
  revokeApiTokenForOwner
} from "@/lib/beta-api-tokens";
import { closeDatabasePools } from "@/lib/db";
import { readDatabaseIdentity } from "@/lib/database-attestation";
import { runPendingMigrations } from "@/lib/migrations";
import {
  cleanupProductionApiCanary,
  prepareProductionApiCanary,
  productionApiCanaryName,
  revokeProductionApiCanary,
  type ProductionApiCanaryContext
} from "@/lib/production-api-canary";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;
const fixture = randomUUID();
const archiveId = `api-canary-${fixture}`;
const ownerId = randomUUID();
const secondOwnerId = randomUUID();
const viewerId = randomUUID();
const context: ProductionApiCanaryContext = {
  releaseCommitSha: "a".repeat(40),
  repository: "kinresolve/kinresolve",
  workflowRunId: "1234567890",
  workflowRunAttempt: 1
};
const apiEnvironment = {
  KINRESOLVE_API_V1_ENABLED: "true",
  KINRESOLVE_API_CURSOR_SECRET: "production-canary-test-cursor-secret-distinct-123456"
};

describeIfDatabase("production API canary database lifecycle", () => {
  const pool = new Pool({ connectionString: databaseUrl!, max: 4 });
  let databaseIdentity = "";

  beforeAll(async () => {
    await runPendingMigrations(pool);
    databaseIdentity = (await readDatabaseIdentity(pool)).fingerprint;
    await pool.query(
      `INSERT INTO public.archives (id, name, slug, dataset_mode)
       VALUES ($1, 'Canary fixture', $1, 'pilot')`,
      [archiveId]
    );
    await pool.query(
      `INSERT INTO public."user" (
         "id", "name", "email", "emailVerified", "createdAt", "updatedAt"
       )
       VALUES
         ($1, 'First owner', $2, true, now(), now()),
         ($3, 'Second owner', $4, true, now(), now()),
         ($5, 'Viewer', $6, true, now(), now())`,
      [
        ownerId, `${ownerId}@example.test`,
        secondOwnerId, `${secondOwnerId}@example.test`,
        viewerId, `${viewerId}@example.test`
      ]
    );
    await pool.query(
      `INSERT INTO public.memberships (archive_id, user_id, role)
       VALUES ($1, $2, 'owner'), ($1, $3, 'owner'), ($1, $4, 'viewer')`,
      [archiveId, ownerId, secondOwnerId, viewerId]
    );
  });

  afterAll(async () => {
    try {
      await pool.query(
        `TRUNCATE TABLE
           public.api_rate_limit_buckets,
           public.security_events,
           public.api_tokens`
      );
      await pool.query("DELETE FROM public.memberships WHERE archive_id = $1", [archiveId]);
      await pool.query(
        'DELETE FROM public."user" WHERE "id" = ANY($1::text[])',
        [[ownerId, secondOwnerId, viewerId]]
      );
      await pool.query("DELETE FROM public.archives WHERE id = $1", [archiveId]);
    } finally {
      await pool.end();
      await closeDatabasePools();
    }
  });

  it("selects the protected expected owner without rejecting a multi-owner archive", async () => {
    const prepared = await prepareProductionApiCanary({
      context,
      databaseUrl: databaseUrl!,
      expectedDatabaseIdentity: databaseIdentity,
      expectedArchiveId: archiveId,
      expectedOwnerUserId: secondOwnerId,
      apiEnvironment
    });
    expect(prepared.metadata.scopes).toEqual(["archive:read"]);
    expect(prepared.metadata).not.toHaveProperty("ownerId");
    expect(prepared.evidence).not.toHaveProperty("tokenId");
    expect(
      new Date(prepared.metadata.expiresAt).getTime()
        - new Date(prepared.metadata.createdAt).getTime()
    ).toBeLessThanOrEqual(120 * 60_000);

    const persisted = await pool.query<{
      archive_id: string;
      user_id: string;
      scopes: string[];
      revoked_at: Date | null;
    }>(
      `SELECT archive_id, user_id, scopes, revoked_at
       FROM public.api_tokens
       WHERE id = $1`,
      [prepared.metadata.tokenId]
    );
    expect(persisted.rows).toEqual([{
      archive_id: archiveId,
      user_id: secondOwnerId,
      scopes: ["archive:read"],
      revoked_at: null
    }]);

    const authorized = await authenticateApiToken(
      new Request("https://app.kinresolve.com/api/v1/meta", {
        headers: { authorization: `Bearer ${prepared.token}` }
      }),
      {
        scope: "archive:read",
        routeTemplate: "/api/v1/meta",
        requestId: randomUUID()
      },
      { databaseUrl: databaseUrl!, environment: apiEnvironment }
    );
    expect(authorized.ok).toBe(true);

    await revokeProductionApiCanary({
      metadata: prepared.metadata,
      context,
      databaseUrl: databaseUrl!,
      expectedDatabaseIdentity: databaseIdentity,
      expectedArchiveId: archiveId,
      expectedOwnerUserId: secondOwnerId,
      apiEnvironment
    });
    const denied = await authenticateApiToken(
      new Request("https://app.kinresolve.com/api/v1/meta", {
        headers: { authorization: `Bearer ${prepared.token}` }
      }),
      {
        scope: "archive:read",
        routeTemplate: "/api/v1/meta",
        requestId: randomUUID()
      },
      { databaseUrl: databaseUrl!, environment: apiEnvironment }
    );
    expect(denied).toMatchObject({ ok: false, status: 401, code: "invalid_token" });

    const events = await pool.query<{ event_type: string; actor_user_id: string }>(
      `SELECT event_type, actor_user_id
       FROM public.security_events
       WHERE token_id = $1
       ORDER BY occurred_at, event_type`,
      [prepared.metadata.tokenId]
    );
    expect(events.rows).toEqual([
      { event_type: "api-token-created", actor_user_id: secondOwnerId },
      { event_type: "api-token-revoked", actor_user_id: secondOwnerId }
    ]);
  });

  it("rejects an explicit expected user who is not a current owner", async () => {
    await expect(prepareProductionApiCanary({
      context: { ...context, workflowRunAttempt: 2 },
      databaseUrl: databaseUrl!,
      expectedDatabaseIdentity: databaseIdentity,
      expectedArchiveId: archiveId,
      expectedOwnerUserId: viewerId,
      apiEnvironment
    })).rejects.toThrow(/not a current archive owner/i);
  });

  it("discovers and revokes committed canary metadata after a local-file crash", async () => {
    const crashContext = { ...context, workflowRunAttempt: 3 };
    const prepared = await prepareProductionApiCanary({
      context: crashContext,
      databaseUrl: databaseUrl!,
      expectedDatabaseIdentity: databaseIdentity,
      expectedArchiveId: archiveId,
      expectedOwnerUserId: ownerId,
      apiEnvironment
    });

    await expect(prepareProductionApiCanary({
      context: crashContext,
      databaseUrl: databaseUrl!,
      expectedDatabaseIdentity: databaseIdentity,
      expectedArchiveId: archiveId,
      expectedOwnerUserId: ownerId,
      apiEnvironment
    })).rejects.toThrow(/already has retained token metadata/i);

    await expect(cleanupProductionApiCanary({
      context: crashContext,
      databaseUrl: databaseUrl!,
      expectedDatabaseIdentity: databaseIdentity,
      expectedArchiveId: archiveId,
      expectedOwnerUserId: ownerId,
      apiEnvironment
    })).resolves.toEqual({ found: true, revoked: true });
    const row = await pool.query<{ revoked: boolean }>(
      `SELECT revoked_at IS NOT NULL AS revoked
       FROM public.api_tokens
       WHERE id = $1`,
      [prepared.metadata.tokenId]
    );
    expect(row.rows).toEqual([{ revoked: true }]);
  });

  it("ignores a participant-created token with the public deterministic canary name", async () => {
    const collisionContext = { ...context, workflowRunAttempt: 4 };
    const participant = await createApiTokenForOwner({
      archiveId,
      userId: ownerId,
      name: productionApiCanaryName(collisionContext),
      scopes: ["archive:read"],
      expiresAt: new Date(Date.now() + 60 * 60_000),
      requestId: randomUUID()
    }, { databaseUrl: databaseUrl!, environment: apiEnvironment });
    const canary = await prepareProductionApiCanary({
      context: collisionContext,
      databaseUrl: databaseUrl!,
      expectedDatabaseIdentity: databaseIdentity,
      expectedArchiveId: archiveId,
      expectedOwnerUserId: ownerId,
      apiEnvironment
    });

    await expect(cleanupProductionApiCanary({
      context: collisionContext,
      databaseUrl: databaseUrl!,
      expectedDatabaseIdentity: databaseIdentity,
      expectedArchiveId: archiveId,
      expectedOwnerUserId: ownerId,
      apiEnvironment
    })).resolves.toEqual({ found: true, revoked: true });
    const rows = await pool.query<{ id: string; revoked: boolean }>(
      `SELECT id, revoked_at IS NOT NULL AS revoked
       FROM public.api_tokens
       WHERE id = ANY($1::text[])
       ORDER BY id`,
      [[participant.id, canary.metadata.tokenId]]
    );
    expect(rows.rows.find((row) => row.id === participant.id)?.revoked).toBe(false);
    expect(rows.rows.find((row) => row.id === canary.metadata.tokenId)?.revoked).toBe(true);
    await revokeApiTokenForOwner({
      archiveId,
      userId: ownerId,
      tokenId: participant.id,
      requestId: randomUUID()
    }, { databaseUrl: databaseUrl!, environment: apiEnvironment });
  });
});
