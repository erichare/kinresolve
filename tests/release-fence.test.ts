import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { closeDatabasePools, query } from "@/lib/db";
import {
  acquireReleaseFence,
  assertReleaseFence,
  assertReleaseWritesAllowed,
  getActiveReleaseFence,
  reacquireReleaseFence,
  releaseReleaseFence,
  ReleaseFenceActiveError,
  ReleaseFenceError,
  validateReleaseFenceIdentity
} from "@/lib/release-fence";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;
const shaA = "a".repeat(40);
const shaB = "b".repeat(40);

describe("release write-fence migration", () => {
  it("defines a SHA-bound durable state machine with at most one active production fence", async () => {
    const migrationName = "013_release_write_fence.sql";
    const sql = (await readFile(path.join(process.cwd(), "db", "migrations", migrationName), "utf8"))
      .toLowerCase();
    const checksums = JSON.parse(await readFile(
      path.join(process.cwd(), "db", "migrations", "checksums.json"),
      "utf8"
    )) as { files: Record<string, string> };

    expect(sql).toContain("create table public.release_write_fences");
    expect(sql).toContain("release_commit_sha");
    expect(sql).toContain("activation_generation");
    expect(sql).toContain("state in ('active', 'released')");
    expect(sql).toMatch(/create unique index release_write_fences_one_active_idx[\s\S]*where state = 'active'/);
    expect(sql).toContain("revoke all privileges on table public.release_write_fences from public");
    expect(sql).toContain("array['anon', 'authenticated']");
    expect(checksums.files[migrationName]).toBe(
      createHash("sha256").update(await readFile(path.join(process.cwd(), "db", "migrations", migrationName))).digest("hex")
    );
  });
});

describe("release fence identity validation", () => {
  it("accepts only a safe fence identifier and a lowercase full Git SHA", () => {
    expect(validateReleaseFenceIdentity({
      fenceId: "fence-private-beta-01",
      releaseCommitSha: shaA
    })).toEqual({ fenceId: "fence-private-beta-01", releaseCommitSha: shaA });

    for (const input of [
      { fenceId: "fence-short", releaseCommitSha: shaA },
      { fenceId: "FENCE-private-beta-01", releaseCommitSha: shaA },
      { fenceId: "fence-private_beta-01", releaseCommitSha: shaA },
      { fenceId: "fence-private-beta-01", releaseCommitSha: shaA.slice(1) },
      { fenceId: "fence-private-beta-01", releaseCommitSha: shaA.toUpperCase() }
    ]) {
      expect(() => validateReleaseFenceIdentity(input)).toThrow(/release fence identity/i);
    }
  });
});

describeIfDatabase("durable release write-fence transitions", () => {
  const options = { databaseUrl: databaseUrl! };
  const createdFenceIds = new Set<string>();

  afterEach(async () => {
    await query(
      "DELETE FROM public.release_write_fences WHERE fence_id = ANY($1::text[])",
      [[...createdFenceIds]],
      options
    );
    createdFenceIds.clear();
  });

  afterAll(async () => {
    await closeDatabasePools();
  });

  it("acquires, asserts, releases, and reacquires the exact SHA-bound fence idempotently", async () => {
    const identity = nextIdentity(createdFenceIds, shaA);

    const acquired = await acquireReleaseFence(identity, options);
    expect(acquired).toMatchObject({
      transition: "acquired",
      fence: { ...identity, state: "active", activationGeneration: 1, releasedAt: null }
    });
    await expect(acquireReleaseFence(identity, options)).resolves.toMatchObject({ transition: "already-active" });
    await expect(assertReleaseFence(identity, options)).resolves.toMatchObject({ transition: "asserted" });
    await expect(getActiveReleaseFence(options)).resolves.toMatchObject(identity);
    await expect(assertReleaseWritesAllowed(options)).rejects.toBeInstanceOf(ReleaseFenceActiveError);

    const released = await releaseReleaseFence(identity, options);
    expect(released).toMatchObject({
      transition: "released",
      fence: { ...identity, state: "released", activationGeneration: 1 }
    });
    expect(released.fence.releasedAt).toEqual(expect.any(String));
    await expect(releaseReleaseFence(identity, options)).resolves.toMatchObject({ transition: "already-released" });
    await expect(getActiveReleaseFence(options)).resolves.toBeNull();
    await expect(assertReleaseWritesAllowed(options)).resolves.toBeUndefined();

    const reacquired = await reacquireReleaseFence(identity, options);
    expect(reacquired).toMatchObject({
      transition: "reacquired",
      fence: { ...identity, state: "active", activationGeneration: 2, releasedAt: null }
    });
    expect(new Date(reacquired.fence.activatedAt).getTime()).toBeGreaterThan(
      new Date(acquired.fence.activatedAt).getTime()
    );
    await expect(reacquireReleaseFence(identity, options)).resolves.toMatchObject({ transition: "already-active" });
  });

  it("rejects unknown, mismatched, stale, and overlapping transitions", async () => {
    const first = nextIdentity(createdFenceIds, shaA);
    const second = nextIdentity(createdFenceIds, shaB);

    await expect(assertReleaseFence(first, options)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(reacquireReleaseFence(first, options)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(releaseReleaseFence(first, options)).rejects.toMatchObject({ code: "NOT_FOUND" });

    await acquireReleaseFence(first, options);
    await expect(acquireReleaseFence(second, options)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(assertReleaseFence({ ...first, releaseCommitSha: shaB }, options)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(releaseReleaseFence({ ...first, releaseCommitSha: shaB }, options)).rejects.toMatchObject({ code: "CONFLICT" });

    await releaseReleaseFence(first, options);
    await expect(acquireReleaseFence(first, options)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(assertReleaseFence(first, options)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(acquireReleaseFence(second, options)).resolves.toMatchObject({ transition: "acquired" });
  });

  it("serializes competing acquisitions so exactly one production fence becomes active", async () => {
    const first = nextIdentity(createdFenceIds, shaA);
    const second = nextIdentity(createdFenceIds, shaB);
    const settled = await Promise.allSettled([
      acquireReleaseFence(first, options),
      acquireReleaseFence(second, options)
    ]);

    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejection = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejection?.reason).toBeInstanceOf(ReleaseFenceError);
    expect(rejection?.reason).toMatchObject({ code: "CONFLICT" });
    await expect(getActiveReleaseFence(options)).resolves.toMatchObject(
      settled[0].status === "fulfilled" ? first : second
    );
  });

  it("grants no fence-table privileges to PUBLIC or Supabase API roles", async () => {
    const result = await query<{ grantee: string; privilege_type: string }>(
      `SELECT COALESCE(role.rolname, 'PUBLIC') AS grantee,
              acl.privilege_type
       FROM pg_class AS relation
       JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       CROSS JOIN LATERAL aclexplode(
         COALESCE(relation.relacl, acldefault('r', relation.relowner))
       ) AS acl
       LEFT JOIN pg_roles AS role ON role.oid = acl.grantee
       WHERE namespace.nspname = 'public'
         AND relation.relname = 'release_write_fences'
         AND (acl.grantee = 0 OR role.rolname IN ('anon', 'authenticated'))`,
      [],
      options
    );

    expect(result.rows).toEqual([]);
  });
});

function nextIdentity(createdFenceIds: Set<string>, releaseCommitSha: string) {
  const fenceId = `fence-test-${randomUUID().replaceAll("-", "")}`;
  createdFenceIds.add(fenceId);
  return { fenceId, releaseCommitSha };
}
