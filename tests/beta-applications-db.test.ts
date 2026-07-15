import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cleanupExpiredBetaApplicationsInTransaction,
  deleteBetaApplicationsForEmail,
  normalizeBetaApplication,
  readBetaApplicationsForEmail,
  submitBetaApplication
} from "@/lib/beta-applications";
import { runPendingMigrations } from "@/lib/migrations";
import type {
  TransactionalEmailMessage,
  TransactionalEmailTransport
} from "@/lib/transactional-email";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;
const environment = {
  APP_BASE_URL: "https://app.kinresolve.com",
  KINRESOLVE_BETA_APPLICATIONS_ENABLED: "true",
  KINRESOLVE_BETA_APPLICATION_HMAC_SECRET: "application-db-test-hmac-secret-123456789",
  KINRESOLVE_TRANSACTIONAL_EMAIL_FROM: "Kin Resolve <beta@kinresolve.com>",
  KINRESOLVE_TRANSACTIONAL_EMAIL_PROVIDER: "resend",
  KINRESOLVE_TRANSACTIONAL_EMAIL_REPLY_TO: "beta@kinresolve.com",
  RESEND_API_KEY: "re_test_1234567890abcdefghijkl"
};

describeIfDatabase("beta application persistence and delivery", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 5 });
    await runPendingMigrations(pool);
    await pool.query("DELETE FROM public.beta_applications WHERE email LIKE '%@beta-application.test'");
  });

  afterAll(async () => {
    await pool.query("DELETE FROM public.beta_applications WHERE email LIKE '%@beta-application.test'");
    await pool.end();
  });

  it("persists first, then resumes only a missing founder delivery on exact same-day retry", async () => {
    const messages: TransactionalEmailMessage[] = [];
    let failFounder = true;
    const transport: TransactionalEmailTransport = {
      async send(message) {
        messages.push(message);
        if (message.kind === "application-founder" && failFounder) {
          failFounder = false;
          throw new Error("provider private failure");
        }
        return { provider: "resend", messageId: `message_${message.kind.replaceAll("-", "_")}` };
      }
    };
    const application = applicationFor("partial@beta-application.test");
    const now = new Date("2026-07-15T12:00:00.000Z");

    await expect(submitBetaApplication(application, {
      databaseUrl,
      environment,
      now: () => now,
      transport
    })).rejects.toMatchObject({ code: "DELIVERY_FAILED" });

    const afterFailure = await pool.query(
      `SELECT * FROM public.beta_applications WHERE email = $1`,
      [application.email]
    );
    expect(afterFailure.rows).toHaveLength(1);
    expect(afterFailure.rows[0]).toMatchObject({
      applicant_delivery_state: "sent",
      founder_delivery_state: "pending",
      delivery_attempt_count: 1
    });
    expect(afterFailure.rows[0].applicant_delivery_message_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(afterFailure.rows[0])).not.toContain("message_application_receipt");

    const resumed = await submitBetaApplication(application, {
      databaseUrl,
      environment,
      now: () => now,
      transport
    });
    expect(resumed.duplicate).toBe(true);
    expect(resumed.applicationId).toBe(afterFailure.rows[0].id);
    expect(messages.map(({ kind }) => kind)).toEqual([
      "application-receipt",
      "application-founder",
      "application-founder"
    ]);
    expect(messages[1]?.idempotencyKey).toBe(messages[2]?.idempotencyKey);

    const sendsBeforeNoop = messages.length;
    await submitBetaApplication(application, {
      databaseUrl,
      environment,
      now: () => now,
      transport
    });
    expect(messages).toHaveLength(sendsBeforeNoop);
    const final = await pool.query(
      `SELECT applicant_delivery_state, founder_delivery_state, delivery_attempt_count
       FROM public.beta_applications WHERE id = $1`,
      [resumed.applicationId]
    );
    expect(final.rows[0]).toEqual({
      applicant_delivery_state: "sent",
      founder_delivery_state: "sent",
      delivery_attempt_count: 2
    });
  });

  it("still notifies the founder when the applicant receipt fails, then resumes only that receipt", async () => {
    const messages: TransactionalEmailMessage[] = [];
    let failReceipt = true;
    const transport: TransactionalEmailTransport = {
      async send(message) {
        messages.push(message);
        if (message.kind === "application-receipt" && failReceipt) {
          failReceipt = false;
          throw new Error("applicant mailbox rejected");
        }
        return { provider: "resend", messageId: `message_${message.kind.replaceAll("-", "_")}` };
      }
    };
    const application = applicationFor("receipt-failure@beta-application.test");
    const now = new Date("2026-07-15T13:00:00.000Z");

    await expect(submitBetaApplication(application, {
      databaseUrl,
      environment,
      now: () => now,
      transport
    })).rejects.toMatchObject({ code: "DELIVERY_FAILED" });

    const afterFailure = await pool.query(
      `SELECT * FROM public.beta_applications WHERE email = $1`,
      [application.email]
    );
    expect(afterFailure.rows).toHaveLength(1);
    expect(afterFailure.rows[0]).toMatchObject({
      applicant_delivery_state: "pending",
      founder_delivery_state: "sent",
      delivery_attempt_count: 1
    });
    expect(afterFailure.rows[0].founder_delivery_message_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(afterFailure.rows[0])).not.toContain("message_application_founder");

    const resumed = await submitBetaApplication(application, {
      databaseUrl,
      environment,
      now: () => now,
      transport
    });
    expect(resumed.duplicate).toBe(true);
    expect(resumed.applicationId).toBe(afterFailure.rows[0].id);
    expect(messages.map(({ kind }) => kind)).toEqual([
      "application-receipt",
      "application-founder",
      "application-receipt"
    ]);
    expect(messages[0]?.idempotencyKey).toBe(messages[2]?.idempotencyKey);

    const final = await pool.query(
      `SELECT applicant_delivery_state, founder_delivery_state, delivery_attempt_count
       FROM public.beta_applications WHERE id = $1`,
      [resumed.applicationId]
    );
    expect(final.rows[0]).toEqual({
      applicant_delivery_state: "sent",
      founder_delivery_state: "sent",
      delivery_attempt_count: 2
    });
  });

  it("permits a legitimate reapplication on a later UTC day", async () => {
    const transport = idempotentTransport();
    const application = applicationFor("future@beta-application.test");
    const first = await submitBetaApplication(application, {
      databaseUrl,
      environment,
      now: () => new Date("2026-07-15T23:59:00.000Z"),
      transport
    });
    const second = await submitBetaApplication(application, {
      databaseUrl,
      environment,
      now: () => new Date("2026-07-16T00:01:00.000Z"),
      transport
    });
    expect(first.applicationId).not.toBe(second.applicationId);
    expect(second.duplicate).toBe(false);
    const rows = await pool.query(
      "SELECT submission_day::text FROM public.beta_applications WHERE email = $1 ORDER BY submission_day",
      [application.email]
    );
    expect(rows.rows).toEqual([
      { submission_day: "2026-07-15" },
      { submission_day: "2026-07-16" }
    ]);
  });

  it("converges concurrent same-day retries even when caller timestamps are inverted", async () => {
    const transport = idempotentTransport(5);
    const application = applicationFor("concurrent@beta-application.test");
    const [later, earlier] = await Promise.all([
      submitBetaApplication(application, {
        databaseUrl,
        environment,
        now: () => new Date("2026-07-15T22:00:00.000Z"),
        transport
      }),
      submitBetaApplication(application, {
        databaseUrl,
        environment,
        now: () => new Date("2026-07-15T01:00:00.000Z"),
        transport
      })
    ]);
    expect(later.applicationId).toBe(earlier.applicationId);
    expect([later.duplicate, earlier.duplicate].sort()).toEqual([false, true]);
    const rows = await pool.query(
      `SELECT applicant_delivery_state, founder_delivery_state, count(*) OVER ()::int AS total
       FROM public.beta_applications WHERE email = $1`,
      [application.email]
    );
    expect(rows.rows).toEqual([{
      applicant_delivery_state: "sent",
      founder_delivery_state: "sent",
      total: 1
    }]);
  });

  it("fails closed when concurrent provider receipts conflict for one idempotency key", async () => {
    const application = applicationFor("conflict@beta-application.test");
    let receiptCalls = 0;
    let releaseReceipts!: () => void;
    const receiptsReady = new Promise<void>((resolve) => { releaseReceipts = resolve; });
    const transport: TransactionalEmailTransport = {
      async send(message) {
        if (message.kind === "application-receipt") {
          const call = ++receiptCalls;
          if (call === 2) releaseReceipts();
          await receiptsReady;
          return { provider: "resend", messageId: `conflicting_receipt_${call}` };
        }
        return { provider: "resend", messageId: "founder_receipt" };
      }
    };
    const results = await Promise.allSettled([
      submitBetaApplication(application, {
        databaseUrl,
        environment,
        now: () => new Date("2026-07-15T10:00:00.000Z"),
        transport
      }),
      submitBetaApplication(application, {
        databaseUrl,
        environment,
        now: () => new Date("2026-07-15T11:00:00.000Z"),
        transport
      })
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "DELIVERY_FAILED" })
    });
  });

  it("supports allowlisted DSAR reads, exact operator deletion, and bounded all-record 90-day retention", async () => {
    const application = applicationFor("dsar@beta-application.test");
    await submitBetaApplication(application, {
      databaseUrl,
      environment,
      now: () => new Date("2026-01-01T12:00:00.000Z"),
      transport: idempotentTransport()
    });
    const records = await readBetaApplicationsForEmail(application.email, { databaseUrl });
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(expect.objectContaining({
      email: application.email,
      consentVersion: "beta-communications-v1",
      state: "pending"
    }));
    expect(JSON.stringify(records)).not.toMatch(/digest|provider|delivery|network|user.?agent/i);

    const deleted = await deleteBetaApplicationsForEmail(application.email, { databaseUrl });
    expect(deleted).toEqual({ deletedCount: 1 });
    expect(await readBetaApplicationsForEmail(application.email, { databaseUrl })).toEqual([]);

    const retained = applicationFor("retention@beta-application.test");
    await submitBetaApplication(retained, {
      databaseUrl,
      environment,
      now: () => new Date("2026-01-02T12:00:00.000Z"),
      transport: idempotentTransport()
    });
    const cleaned = await withPoolTransaction(pool, (client) =>
      cleanupExpiredBetaApplicationsInTransaction(client, 1)
    );
    expect(cleaned).toBe(1);
    expect(await readBetaApplicationsForEmail(retained.email, { databaseUrl })).toEqual([]);
  });

  it("enforces immutable identity, consent, retention, sent receipts, and monotonic delivery evidence while allowing deletion", async () => {
    const application = applicationFor("invariants@beta-application.test");
    const created = await submitBetaApplication(application, {
      databaseUrl,
      environment,
      now: () => new Date("2026-07-15T12:00:00.000Z"),
      transport: idempotentTransport()
    });
    for (const mutation of [
      "name = 'Changed Name'",
      "consent_version = 'beta-communications-v0'",
      "consented_at = consented_at + interval '1 second'",
      "retention_expires_at = retention_expires_at + interval '1 day'",
      "applicant_delivery_state = 'pending', applicant_delivery_provider = NULL, applicant_delivery_message_digest = NULL, applicant_delivered_at = NULL",
      "applicant_delivery_message_digest = repeat('f', 64)",
      "founder_delivery_state = 'pending', founder_delivery_provider = NULL, founder_delivery_message_digest = NULL, founder_delivered_at = NULL",
      "founder_delivery_message_digest = repeat('e', 64)",
      "delivery_attempt_count = delivery_attempt_count - 1",
      "last_delivery_attempt_at = created_at - interval '1 second'",
      "updated_at = created_at - interval '1 second'"
    ]) {
      await expect(pool.query(
        `UPDATE public.beta_applications SET ${mutation} WHERE id = $1::uuid`,
        [created.applicationId]
      ), mutation).rejects.toThrow();
    }
    await expect(pool.query(
      "DELETE FROM public.beta_applications WHERE id = $1::uuid",
      [created.applicationId]
    )).resolves.toMatchObject({ rowCount: 1 });
  });

  it("exposes only the minimal schema, RLS, and revoked public roles", async () => {
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'beta_applications'
       ORDER BY ordinal_position`
    );
    expect(columns.rows.map(({ column_name }) => column_name)).toEqual([
      "id", "submission_day", "submission_digest", "email_digest", "name", "email",
      "researcher_type", "workflow", "archive_size_band", "current_tool",
      "consent_version", "consented_at", "state", "applicant_delivery_state",
      "applicant_delivery_provider", "applicant_delivery_message_digest",
      "applicant_delivered_at", "founder_delivery_state", "founder_delivery_provider",
      "founder_delivery_message_digest", "founder_delivered_at", "delivery_attempt_count",
      "last_delivery_attempt_at", "created_at", "updated_at", "retention_expires_at"
    ]);
    expect(columns.rows.map(({ column_name }) => column_name).join(" "))
      .not.toMatch(/ip|address|agent|header|body|content|redirect/);
    const security = await pool.query(
      `SELECT c.relrowsecurity AS rls,
              has_table_privilege('public', 'public.beta_applications', 'SELECT') AS public_select,
              has_table_privilege('public', 'public.beta_applications', 'INSERT') AS public_insert
       FROM pg_catalog.pg_class AS c
       JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'beta_applications'`
    );
    expect(security.rows).toEqual([{ rls: true, public_select: false, public_insert: false }]);
  });
});

function applicationFor(email: string) {
  return normalizeBetaApplication({
    archiveSizeBand: "1000-10000",
    consentVersion: "beta-communications-v1",
    currentTool: "gramps",
    email,
    name: "Beta Application Researcher",
    researcherType: "family-historian",
    workflow: "research-cases"
  });
}

function idempotentTransport(delayMs = 0): TransactionalEmailTransport {
  const ids = new Map<string, string>();
  return {
    async send(message) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      let id = ids.get(message.idempotencyKey);
      if (!id) {
        id = `message_${ids.size + 1}`;
        ids.set(message.idempotencyKey, id);
      }
      return { provider: "resend", messageId: id };
    }
  };
}

async function withPoolTransaction<T>(
  pool: Pool,
  callback: (client: import("pg").PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await callback(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
