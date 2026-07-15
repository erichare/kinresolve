import type { PoolClient } from "pg";

import {
  query,
  withTransaction,
  type DatabaseOptions
} from "./db";

const releaseFenceIdPattern = /^fence-[a-z0-9][a-z0-9-]{7,63}$/;
const fullGitShaPattern = /^[a-f0-9]{40}$/;
const releaseFenceCell = "production";

export type ReleaseFenceIdentity = {
  fenceId: string;
  releaseCommitSha: string;
};

export type ReleaseFenceState = "active" | "released";

export type ReleaseFence = ReleaseFenceIdentity & {
  state: ReleaseFenceState;
  activationGeneration: number;
  firstActivatedAt: string;
  activatedAt: string;
  releasedAt: string | null;
  updatedAt: string;
};

export type ReleaseFenceTransition =
  | "acquired"
  | "already-active"
  | "asserted"
  | "reacquired"
  | "released"
  | "already-released";

export type ReleaseFenceTransitionResult = {
  fence: ReleaseFence;
  transition: ReleaseFenceTransition;
};

export type ReleaseFenceErrorCode = "INVALID_IDENTITY" | "NOT_FOUND" | "CONFLICT";

export class ReleaseFenceError extends Error {
  readonly code: ReleaseFenceErrorCode;

  constructor(code: ReleaseFenceErrorCode, message: string) {
    super(message);
    this.name = "ReleaseFenceError";
    this.code = code;
  }
}

export class ReleaseFenceActiveError extends Error {
  readonly fence: ReleaseFence;

  constructor(fence: ReleaseFence) {
    super("Production writes are paused by an active release fence.");
    this.name = "ReleaseFenceActiveError";
    this.fence = fence;
  }
}

type ReleaseFenceRow = {
  fence_id: string;
  release_commit_sha: string;
  state: ReleaseFenceState;
  activation_generation: number;
  first_activated_at: Date | string;
  activated_at: Date | string;
  released_at: Date | string | null;
  updated_at: Date | string;
};

export function validateReleaseFenceIdentity(value: ReleaseFenceIdentity): ReleaseFenceIdentity {
  if (
    typeof value !== "object"
    || value === null
    || !releaseFenceIdPattern.test(value.fenceId)
    || !fullGitShaPattern.test(value.releaseCommitSha)
  ) {
    throw new ReleaseFenceError("INVALID_IDENTITY", "The release fence identity is invalid.");
  }

  return {
    fenceId: value.fenceId,
    releaseCommitSha: value.releaseCommitSha
  };
}

export async function getActiveReleaseFence(options: DatabaseOptions = {}): Promise<ReleaseFence | null> {
  const result = await query<ReleaseFenceRow>(
    `${selectFenceColumns}
     WHERE cell = $1 AND state = 'active'`,
    [releaseFenceCell],
    options
  );
  return result.rows[0] ? mapFence(result.rows[0]) : null;
}

export async function assertReleaseWritesAllowed(options: DatabaseOptions = {}): Promise<void> {
  const activeFence = await getActiveReleaseFence(options);
  if (activeFence) throw new ReleaseFenceActiveError(activeFence);
}

export async function acquireReleaseFence(
  value: ReleaseFenceIdentity,
  options: DatabaseOptions = {}
): Promise<ReleaseFenceTransitionResult> {
  const identity = validateReleaseFenceIdentity(value);
  return withFenceTransaction(options, async (client) => {
    const existing = await selectFenceById(client, identity.fenceId);
    if (existing) {
      assertSameCommit(existing, identity);
      if (existing.state === "active") return { fence: existing, transition: "already-active" };
      throw conflict("A released fence must be reacquired, not acquired again.");
    }

    const active = await selectActiveFence(client);
    if (active) throw conflict("Another release fence is already active.");

    const inserted = await client.query<ReleaseFenceRow>(
      `INSERT INTO public.release_write_fences (
         cell, fence_id, release_commit_sha, state
       ) VALUES ($1, $2, $3, 'active')
       RETURNING ${returningFenceColumns}`,
      [releaseFenceCell, identity.fenceId, identity.releaseCommitSha]
    );
    return { fence: requiredFence(inserted.rows[0]), transition: "acquired" };
  });
}

export async function assertReleaseFence(
  value: ReleaseFenceIdentity,
  options: DatabaseOptions = {}
): Promise<ReleaseFenceTransitionResult> {
  const identity = validateReleaseFenceIdentity(value);
  const result = await query<ReleaseFenceRow>(
    `${selectFenceColumns}
     WHERE cell = $1 AND fence_id = $2`,
    [releaseFenceCell, identity.fenceId],
    options
  );
  const fence = result.rows[0] ? mapFence(result.rows[0]) : null;
  if (!fence) throw notFound();
  assertSameCommit(fence, identity);
  if (fence.state !== "active") throw conflict("The requested release fence is not active.");
  return { fence, transition: "asserted" };
}

export async function reacquireReleaseFence(
  value: ReleaseFenceIdentity,
  options: DatabaseOptions = {}
): Promise<ReleaseFenceTransitionResult> {
  const identity = validateReleaseFenceIdentity(value);
  return withFenceTransaction(options, async (client) => {
    const existing = await selectFenceById(client, identity.fenceId);
    if (!existing) throw notFound();
    assertSameCommit(existing, identity);
    if (existing.state === "active") return { fence: existing, transition: "already-active" };

    const active = await selectActiveFence(client);
    if (active) throw conflict("Another release fence is already active.");

    const updated = await client.query<ReleaseFenceRow>(
      `UPDATE public.release_write_fences
       SET state = 'active',
           activation_generation = activation_generation + 1,
           activated_at = GREATEST(clock_timestamp(), activated_at + interval '1 millisecond'),
           released_at = NULL,
           updated_at = GREATEST(clock_timestamp(), activated_at + interval '1 millisecond')
       WHERE cell = $1 AND fence_id = $2 AND state = 'released'
       RETURNING ${returningFenceColumns}`,
      [releaseFenceCell, identity.fenceId]
    );
    return { fence: requiredFence(updated.rows[0]), transition: "reacquired" };
  });
}

export async function releaseReleaseFence(
  value: ReleaseFenceIdentity,
  options: DatabaseOptions = {}
): Promise<ReleaseFenceTransitionResult> {
  const identity = validateReleaseFenceIdentity(value);
  return withFenceTransaction(options, async (client) => {
    const existing = await selectFenceById(client, identity.fenceId);
    if (!existing) throw notFound();
    assertSameCommit(existing, identity);
    if (existing.state === "released") return { fence: existing, transition: "already-released" };

    const updated = await client.query<ReleaseFenceRow>(
      `UPDATE public.release_write_fences
       SET state = 'released', released_at = clock_timestamp(), updated_at = clock_timestamp()
       WHERE cell = $1 AND fence_id = $2 AND state = 'active'
       RETURNING ${returningFenceColumns}`,
      [releaseFenceCell, identity.fenceId]
    );
    return { fence: requiredFence(updated.rows[0]), transition: "released" };
  });
}

const selectFenceColumns = `SELECT fence_id, release_commit_sha, state, activation_generation,
       first_activated_at, activated_at, released_at, updated_at
     FROM public.release_write_fences`;
const returningFenceColumns = `fence_id, release_commit_sha, state, activation_generation,
       first_activated_at, activated_at, released_at, updated_at`;

async function withFenceTransaction<T>(
  options: DatabaseOptions,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  return withTransaction(options, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('kinresolve.release-write-fence.production', 0))"
    );
    return callback(client);
  });
}

async function selectFenceById(client: PoolClient, fenceId: string): Promise<ReleaseFence | null> {
  const result = await client.query<ReleaseFenceRow>(
    `${selectFenceColumns}
     WHERE cell = $1 AND fence_id = $2
     FOR UPDATE`,
    [releaseFenceCell, fenceId]
  );
  return result.rows[0] ? mapFence(result.rows[0]) : null;
}

async function selectActiveFence(client: PoolClient): Promise<ReleaseFence | null> {
  const result = await client.query<ReleaseFenceRow>(
    `${selectFenceColumns}
     WHERE cell = $1 AND state = 'active'
     FOR UPDATE`,
    [releaseFenceCell]
  );
  return result.rows[0] ? mapFence(result.rows[0]) : null;
}

function assertSameCommit(fence: ReleaseFence, identity: ReleaseFenceIdentity): void {
  if (fence.releaseCommitSha !== identity.releaseCommitSha) {
    throw conflict("The release fence is bound to a different commit.");
  }
}

function mapFence(row: ReleaseFenceRow): ReleaseFence {
  return {
    fenceId: row.fence_id,
    releaseCommitSha: row.release_commit_sha,
    state: row.state,
    activationGeneration: Number(row.activation_generation),
    firstActivatedAt: isoTimestamp(row.first_activated_at),
    activatedAt: isoTimestamp(row.activated_at),
    releasedAt: row.released_at === null ? null : isoTimestamp(row.released_at),
    updatedAt: isoTimestamp(row.updated_at)
  };
}

function requiredFence(row: ReleaseFenceRow | undefined): ReleaseFence {
  if (!row) throw new Error("The release fence transition did not return a row.");
  return mapFence(row);
}

function isoTimestamp(value: Date | string): string {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error("The release fence timestamp is invalid.");
  return timestamp.toISOString();
}

function conflict(message: string): ReleaseFenceError {
  return new ReleaseFenceError("CONFLICT", message);
}

function notFound(): ReleaseFenceError {
  return new ReleaseFenceError("NOT_FOUND", "The release fence was not found.");
}
