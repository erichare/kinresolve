import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { closeDatabasePools } from "@/lib/db";
import { runPendingMigrations } from "@/lib/migrations";
import { publicDemoNoticeVersion } from "@/lib/public-demo-contract";
import {
  readPublicDemoStats,
  recordPublicDemoEvent
} from "@/lib/public-demo-session-store";
import { addCaseTask, createCase, recordCaseTaskOutcome } from "@/lib/workspace-store";
import { provisionTestArchive } from "@/tests/helpers/provision-test-archive";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;
const now = new Date("2026-07-18T12:00:00.000Z");

describeIfDatabase("public demo stats database contract", () => {
  let pool: Pool;
  const sessionIds: string[] = [];
  const archiveIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 3 });
    await runPendingMigrations(pool);
  });

  afterEach(async () => {
    await pool.query("DELETE FROM public.public_demo_events WHERE occurred_at = $1", [now]);
    if (sessionIds.length > 0) {
      await pool.query(
        "DELETE FROM public.public_demo_sessions WHERE id = ANY($1::uuid[])",
        [sessionIds.splice(0)]
      );
    }
    if (archiveIds.length > 0) {
      await pool.query("DELETE FROM public.archives WHERE id = ANY($1)", [archiveIds.splice(0)]);
    }
  });

  afterAll(async () => {
    await pool.end();
    await closeDatabasePools();
  });

  async function insertSession(isCanary: boolean): Promise<string> {
    const sessionId = randomUUID();
    sessionIds.push(sessionId);
    await pool.query(
      `INSERT INTO public.public_demo_sessions (
         id, token_digest, archive_id, generation, status, notice_version,
         reset_count, ai_attempts_used, is_canary, created_at, expires_at, updated_at
       ) VALUES (
         $1::uuid, $2, $3, 1, 'active', $4,
         0, 0, $5, $6, $6::timestamptz + interval '24 hours', $6
       )`,
      [
        sessionId,
        randomBytes(32).toString("hex"),
        `demo-${randomBytes(16).toString("hex")}`,
        publicDemoNoticeVersion,
        isCanary,
        now
      ]
    );
    return sessionId;
  }

  async function statsRow(): Promise<{ total: string; updated_at: Date }> {
    const result = await pool.query<{ total: string; updated_at: Date }>(
      `SELECT outcomes_completed_total::text AS total, updated_at
       FROM public.public_demo_stats
       WHERE singleton = true`
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!;
  }

  it("increments the durable counter exactly when a real outcome event is admitted", async () => {
    const sessionId = await insertSession(false);
    const before = await statsRow();

    await recordPublicDemoEvent(
      { sessionId, eventName: "outcome_completed", now },
      { databaseUrl }
    );

    const after = await statsRow();
    expect(BigInt(after.total)).toBe(BigInt(before.total) + 1n);
    expect(after.updated_at.getTime()).toBeGreaterThanOrEqual(now.getTime());
    const view = await readPublicDemoStats({ databaseUrl });
    expect(view.mysteriesSolved).toBe(Number(after.total));
    // Compare against the database clock so runner-vs-DB clock skew cannot flake this.
    const databaseNow = await pool.query<{ now: Date }>("SELECT now() AS now");
    expect(new Date(view.since).getTime()).toBeLessThanOrEqual(databaseNow.rows[0]!.now.getTime());
  });

  it("counts a replayed outcome request exactly once in the events and the durable counter", async () => {
    const sessionId = await insertSession(false);
    const archiveId = `test-stats-${randomUUID()}`;
    archiveIds.push(archiveId);
    const storeOptions = { databaseUrl, archiveId };
    await provisionTestArchive(storeOptions);
    const researchCase = await createCase(
      {
        id: "case-replay-count",
        title: "Replay counting test",
        question: "Does an idempotent replay count twice?"
      },
      storeOptions
    );
    const createdTask = await addCaseTask(
      researchCase.id,
      { id: "task-replay-count", title: "Compare the signatures" },
      storeOptions
    );
    const before = await statsRow();

    const outcomeInput = {
      requestId: `request-${randomUUID()}`,
      expectedTaskUpdatedAt: createdTask.task.updatedAt!,
      outcome: "found" as const,
      note: "The fictional signatures share the assigned features.",
      actorId: `demo:${sessionId}`,
      actorName: "Demo Guest"
    };
    // Mirror the guide route contract: outcome telemetry is recorded only
    // for newly applied outcomes, never for idempotent replays.
    const first = await recordCaseTaskOutcome(researchCase.id, createdTask.task.id, outcomeInput, storeOptions);
    if (first.applied) {
      await recordPublicDemoEvent({ sessionId, eventName: "outcome_completed", now }, { databaseUrl });
    }
    const replay = await recordCaseTaskOutcome(researchCase.id, createdTask.task.id, outcomeInput, storeOptions);
    if (replay.applied) {
      await recordPublicDemoEvent({ sessionId, eventName: "outcome_completed", now }, { databaseUrl });
    }

    expect(first.applied).toBe(true);
    expect(replay.applied).toBe(false);
    const after = await statsRow();
    expect(BigInt(after.total)).toBe(BigInt(before.total) + 1n);
    const events = await pool.query(
      `SELECT 1 FROM public.public_demo_events
       WHERE session_id = $1::uuid AND event_name = 'outcome_completed'`,
      [sessionId]
    );
    expect(events.rows).toHaveLength(1);
  });

  it("does not count canary-excluded outcome events or non-outcome events", async () => {
    const canarySessionId = await insertSession(true);
    const realSessionId = await insertSession(false);
    const before = await statsRow();

    await recordPublicDemoEvent(
      { sessionId: canarySessionId, eventName: "outcome_completed", now },
      { databaseUrl }
    );
    const excludedEvents = await pool.query(
      "SELECT 1 FROM public.public_demo_events WHERE session_id = $1::uuid",
      [canarySessionId]
    );
    expect(excludedEvents.rows).toHaveLength(0);

    await recordPublicDemoEvent(
      { sessionId: realSessionId, eventName: "guide_started", now },
      { databaseUrl }
    );
    await recordPublicDemoEvent({ eventName: "landing_viewed", now }, { databaseUrl });

    const after = await statsRow();
    expect(after.total).toBe(before.total);
  });
});
