import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { closeDatabasePools } from "@/lib/db";
import { runPendingMigrations } from "@/lib/migrations";
import { publicDemoNoticeVersion } from "@/lib/public-demo-contract";
import { publicDemoSessionPolicy } from "@/lib/public-demo-sessions";
import {
  endPublicDemoSession,
  startPublicDemoSession
} from "@/lib/public-demo-session-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;
const now = new Date("2026-07-19T12:00:00.000Z");

describeIfDatabase("public demo launch-scale load protection", () => {
  let pool: Pool;
  const sessionIds: string[] = [];
  const archiveIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 3 });
    await runPendingMigrations(pool);
  });

  afterEach(async () => {
    await pool.query(
      "DELETE FROM public.public_demo_events WHERE occurred_at BETWEEN $1::timestamptz - interval '1 hour' AND $1::timestamptz + interval '1 hour'",
      [now]
    );
    if (sessionIds.length > 0) {
      await pool.query(
        "DELETE FROM public.public_demo_generations WHERE session_id = ANY($1::uuid[])",
        [sessionIds]
      );
      await pool.query(
        "DELETE FROM public.public_demo_sessions WHERE id = ANY($1::uuid[])",
        [sessionIds.splice(0)]
      );
    }
    if (archiveIds.length > 0) {
      await pool.query("DELETE FROM public.archives WHERE id = ANY($1)", [archiveIds.splice(0)]);
    }
    await pool.query("DELETE FROM public.public_demo_rate_limits");
  });

  afterAll(async () => {
    await pool.end();
    await closeDatabasePools();
  });

  async function occupyCapacity(count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      const sessionId = randomUUID();
      sessionIds.push(sessionId);
      await pool.query(
        `INSERT INTO public.public_demo_sessions (
           id, token_digest, archive_id, generation, status, notice_version,
           reset_count, ai_attempts_used, is_canary, created_at, expires_at, updated_at
         ) VALUES (
           $1::uuid, $2, $3, 1, 'active', $4,
           0, 0, false, $5, $5::timestamptz + interval '24 hours', $5
         )`,
        [
          sessionId,
          randomBytes(32).toString("hex"),
          `demo-${randomUUID().replaceAll("-", "")}`,
          publicDemoNoticeVersion,
          now
        ]
      );
    }
  }

  it("fast-429s a brand-new start at full capacity and records the rejection event", async () => {
    await occupyCapacity(publicDemoSessionPolicy.maximumActiveSessions);

    const result = await startPublicDemoSession({
      noticeVersion: publicDemoNoticeVersion,
      networkSubjectDigest: "a".repeat(64),
      now
    }, { databaseUrl });

    expect(result).toEqual({
      kind: "capacity-exceeded",
      maximumActiveSessions: publicDemoSessionPolicy.maximumActiveSessions
    });

    // The fast path performed no reservation work at all: no new session row,
    // no rate-limit bucket consumption — only the aggregate rejection event.
    const sessions = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.public_demo_sessions WHERE status IN ('active', 'provisioning')"
    );
    expect(Number(sessions.rows[0]?.count)).toBe(publicDemoSessionPolicy.maximumActiveSessions);
    const buckets = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.public_demo_rate_limits"
    );
    expect(Number(buckets.rows[0]?.count)).toBe(0);
    const events = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.public_demo_events WHERE event_name = 'capacity_rejected' AND occurred_at = $1",
      [now]
    );
    expect(Number(events.rows[0]?.count)).toBe(1);
  });

  it("admits a start below capacity through the bounded-timeout reservation transaction", async () => {
    await occupyCapacity(publicDemoSessionPolicy.maximumActiveSessions - 1);

    const started = await startPublicDemoSession({
      noticeVersion: publicDemoNoticeVersion,
      networkSubjectDigest: "b".repeat(64),
      isCanary: true,
      now
    }, { databaseUrl });

    expect(started.kind).toBe("created");
    if (started.kind !== "created") throw new Error("unreachable");
    sessionIds.push(started.session.sessionId);
    archiveIds.push(started.session.archiveId);

    // The SET LOCAL lock/statement timeouts are transaction-scoped: the pooled
    // connection must return to its defaults after the reservation commits.
    const residual = await pool.query<{ lock_timeout: string; statement_timeout: string }>(
      "SELECT current_setting('lock_timeout') AS lock_timeout, current_setting('statement_timeout') AS statement_timeout"
    );
    expect(residual.rows[0]?.lock_timeout).toBe("0");
    expect(residual.rows[0]?.statement_timeout).toBe("0");

    await endPublicDemoSession(started.rawToken, { now }, { databaseUrl });
  });
});
