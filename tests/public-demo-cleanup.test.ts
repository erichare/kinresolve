import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));
const workspaceMocks = vi.hoisted(() => ({
  provisionArchive: vi.fn()
}));

vi.mock("@/lib/db", () => dbMocks);
vi.mock("@/lib/workspace-store", () => workspaceMocks);

import {
  cleanupPublicDemoSessions,
  startPublicDemoSession
} from "@/lib/public-demo-session-store";
import { publicDemoNoticeVersion } from "@/lib/public-demo-contract";

const now = new Date("2026-07-16T12:00:00.000Z");
const staleSessionId = "11111111-1111-4111-8111-111111111111";
const staleArchiveId = "demo-11111111111111111111111111111111";

describe("public demo provisioning recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("fails provisioning sessions stale for two minutes and queues their generation for cleanup", async () => {
    const transactionSql: string[] = [];
    const directSql: string[] = [];
    dbMocks.withTransaction.mockImplementation(async (_options, callback) => callback({
      query: vi.fn(async (sql: string) => {
        transactionSql.push(sql);
        if (sql.includes("AS available")) return { rows: [{ available: true }], rowCount: 1 };
        if (sql.includes("updated_at <= $1 - interval '2 minutes'")) {
          return { rows: [{ id: staleSessionId }], rowCount: 1 };
        }
        if (sql.includes("status IN ('active', 'provisioning') AND expires_at <= $1")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("FROM public.public_demo_generations") && sql.includes("FOR UPDATE SKIP LOCKED")) {
          return {
            rows: [{ archive_id: staleArchiveId, session_id: staleSessionId, generation: 1 }],
            rowCount: 1
          };
        }
        return { rows: [], rowCount: 0 };
      })
    }));
    dbMocks.query.mockImplementation(async (sql: string) => {
      directSql.push(sql);
      return { rows: [], rowCount: sql.includes("public_demo_events") ? 0 : 1 };
    });

    const result = await cleanupPublicDemoSessions({
      now,
      leaseOwner: "22222222-2222-4222-8222-222222222222"
    });

    expect(transactionSql).toEqual(expect.arrayContaining([
      expect.stringMatching(/SET status = 'failed'.*updated_at <= \$1 - interval '2 minutes'/s),
      expect.stringMatching(/SET state = 'failed'.*session_id = ANY/s)
    ]));
    expect(directSql).toContain("DELETE FROM public.archives WHERE id = $1");
    expect(result).toMatchObject({ archivesCleaned: 1, staleProvisioningRecovered: 1 });
  });

  it("marks the reserved generation failed when initial archive provisioning fails", async () => {
    const transactionSql: string[] = [];
    dbMocks.withTransaction.mockImplementation(async (_options, callback) => callback({
      query: vi.fn(async (sql: string) => {
        transactionSql.push(sql);
        if (sql.includes("SELECT request_count")) {
          return { rows: [{ request_count: 0, expires_at: new Date(now.getTime() + 3_600_000) }], rowCount: 1 };
        }
        if (sql.includes("count(*) FILTER")) {
          return { rows: [{ active: 0, provisioning: 0 }], rowCount: 1 };
        }
        if (sql.includes("SET status = 'failed'")) {
          return { rows: [{ id: staleSessionId }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      })
    }));
    workspaceMocks.provisionArchive.mockRejectedValueOnce(new Error("fixture provisioning failed"));

    await expect(startPublicDemoSession({
      noticeVersion: publicDemoNoticeVersion,
      networkSubjectDigest: "a".repeat(64),
      now
    })).rejects.toThrow("fixture provisioning failed");

    expect(transactionSql).toEqual(expect.arrayContaining([
      expect.stringMatching(/SET status = 'failed'.*status = 'provisioning'/s),
      expect.stringMatching(/SET state = 'failed'.*state = 'provisioning'/s)
    ]));
  });
});
