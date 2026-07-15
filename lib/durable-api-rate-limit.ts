import type { PoolClient } from "pg";

import { withTransaction, type DatabaseOptions } from "./db";
import type { ApiV1RateLimitProfile } from "./api-v1-contract";

export type ApiRateLimitHeaders = {
  limit: number;
  remaining: number;
  reset: number;
  retryAfter?: number;
};

export type ApiRateLimitWindow = {
  kind: "minute" | "day";
  limit: number;
  remaining: number;
  reset: number;
};

export type DurableApiRateLimitResult = {
  allowed: boolean;
  profile: ApiV1RateLimitProfile;
  minute: ApiRateLimitWindow;
  day: ApiRateLimitWindow;
  rateLimit: ApiRateLimitHeaders;
};

type ApiRateLimitPolicy = {
  kind: ApiRateLimitWindow["kind"];
  maximumRequests: number;
  windowSeconds: number;
};

type BucketRow = {
  bucket_kind: string;
  expired: boolean;
  request_count: number;
  reset_seconds: number;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const apiRateLimitPolicies: Readonly<Record<ApiV1RateLimitProfile, readonly ApiRateLimitPolicy[]>> = {
  standard: [
    { kind: "minute", maximumRequests: 60, windowSeconds: 60 },
    { kind: "day", maximumRequests: 10_000, windowSeconds: 86_400 }
  ],
  export: [
    { kind: "minute", maximumRequests: 1, windowSeconds: 60 },
    { kind: "day", maximumRequests: 10, windowSeconds: 86_400 }
  ]
};

export async function consumeDurableApiRateLimit(
  input: { tokenId: string; profile: ApiV1RateLimitProfile },
  options: DatabaseOptions = {}
): Promise<DurableApiRateLimitResult> {
  return withTransaction(options, (client) => consumeApiRateLimitInTransaction(client, input));
}

export async function consumeApiRateLimitInTransaction(
  client: PoolClient,
  input: { tokenId: string; profile: ApiV1RateLimitProfile }
): Promise<DurableApiRateLimitResult> {
  validateTokenId(input.tokenId);
  const policies = apiRateLimitPolicies[input.profile];
  if (!policies) throw new Error("The API rate-limit profile is invalid.");

  for (const policy of policies) {
    await client.query(
      `INSERT INTO public.api_rate_limit_buckets (
         token_id, bucket_kind, request_count, window_started_at, expires_at, updated_at
       )
       VALUES (
         $1, $2, 0, clock_timestamp(),
         clock_timestamp() + ($3::bigint * interval '1 second'), clock_timestamp()
       )
       ON CONFLICT (token_id, bucket_kind) DO UPDATE
       SET updated_at = public.api_rate_limit_buckets.updated_at`,
      [input.tokenId, bucketKind(input.profile, policy.kind), policy.windowSeconds]
    );
  }

  const locked = await client.query<BucketRow>(
    `SELECT bucket_kind,
            request_count,
            expires_at <= clock_timestamp() AS expired,
            GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - clock_timestamp())))::integer)
              AS reset_seconds
     FROM public.api_rate_limit_buckets
     WHERE token_id = $1
       AND bucket_kind = ANY($2::text[])
     ORDER BY bucket_kind COLLATE "C"
     FOR UPDATE`,
    [input.tokenId, policies.map((policy) => bucketKind(input.profile, policy.kind))]
  );
  if (locked.rows.length !== policies.length) {
    throw new Error("The durable API rate-limit bucket inventory is incomplete.");
  }

  const normalized = new Map<string, BucketRow>();
  for (const policy of policies) {
    const kind = bucketKind(input.profile, policy.kind);
    const current = locked.rows.find((row) => row.bucket_kind === kind);
    if (!current) throw new Error("The durable API rate-limit bucket inventory is incomplete.");
    if (!current.expired) {
      normalized.set(kind, current);
      continue;
    }
    const reset = await client.query<BucketRow>(
      `UPDATE public.api_rate_limit_buckets
       SET request_count = 0,
           window_started_at = clock_timestamp(),
           expires_at = clock_timestamp() + ($3::bigint * interval '1 second'),
           updated_at = clock_timestamp()
       WHERE token_id = $1 AND bucket_kind = $2
       RETURNING bucket_kind, request_count, false AS expired,
         GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - clock_timestamp())))::integer)
           AS reset_seconds`,
      [input.tokenId, kind, policy.windowSeconds]
    );
    const row = reset.rows[0];
    if (!row) throw new Error("The durable API rate-limit bucket could not be reset.");
    normalized.set(kind, row);
  }

  const denied = policies.filter((policy) => {
    const row = normalized.get(bucketKind(input.profile, policy.kind));
    return !row || row.request_count >= policy.maximumRequests;
  });
  if (denied.length > 0) {
    const windows = policyWindows(input.profile, policies, normalized);
    const deniedWindows = denied.map((policy) => windows[policy.kind]);
    const governing = deniedWindows.reduce((current, candidate) =>
      candidate.reset > current.reset ? candidate : current
    );
    return {
      allowed: false,
      profile: input.profile,
      ...windows,
      rateLimit: {
        limit: governing.limit,
        remaining: 0,
        reset: governing.reset,
        retryAfter: governing.reset
      }
    };
  }

  const updated = new Map<string, BucketRow>();
  for (const policy of policies) {
    const kind = bucketKind(input.profile, policy.kind);
    const result = await client.query<BucketRow>(
      `UPDATE public.api_rate_limit_buckets
       SET request_count = request_count + 1,
           updated_at = clock_timestamp()
       WHERE token_id = $1 AND bucket_kind = $2
       RETURNING bucket_kind, request_count, false AS expired,
         GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - clock_timestamp())))::integer)
           AS reset_seconds`,
      [input.tokenId, kind]
    );
    const row = result.rows[0];
    if (!row) throw new Error("The durable API rate-limit bucket could not be updated.");
    updated.set(kind, row);
  }
  const windows = policyWindows(input.profile, policies, updated);
  const governing = governingWindow(windows.minute, windows.day);
  return {
    allowed: true,
    profile: input.profile,
    ...windows,
    rateLimit: {
      limit: governing.limit,
      remaining: governing.remaining,
      reset: governing.reset
    }
  };
}

export async function cleanupExpiredApiRateLimits(
  input: { limit?: number } = {},
  options: DatabaseOptions = {}
): Promise<number> {
  const limit = input.limit ?? 500;
  return withTransaction(options, (client) => cleanupExpiredApiRateLimitsInTransaction(client, limit));
}

export async function cleanupExpiredApiRateLimitsInTransaction(
  client: PoolClient,
  limit: number
): Promise<number> {
  validateCleanupLimit(limit);
  const result = await client.query(
    `WITH expired AS (
       SELECT ctid
       FROM public.api_rate_limit_buckets
       WHERE expires_at <= clock_timestamp()
       ORDER BY expires_at, token_id, bucket_kind
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     DELETE FROM public.api_rate_limit_buckets AS bucket
     USING expired
     WHERE bucket.ctid = expired.ctid`,
    [limit]
  );
  return result.rowCount ?? 0;
}

function policyWindows(
  profile: ApiV1RateLimitProfile,
  policies: readonly ApiRateLimitPolicy[],
  rows: Map<string, BucketRow>
): { minute: ApiRateLimitWindow; day: ApiRateLimitWindow } {
  const window = (kind: ApiRateLimitWindow["kind"]): ApiRateLimitWindow => {
    const policy = policies.find((candidate) => candidate.kind === kind);
    const row = policy && rows.get(bucketKind(profile, kind));
    if (!policy || !row) throw new Error("The durable API rate-limit result is incomplete.");
    const count = row.request_count;
    return {
      kind,
      limit: policy.maximumRequests,
      remaining: Math.max(0, policy.maximumRequests - count),
      reset: row.reset_seconds
    };
  };
  return { minute: window("minute"), day: window("day") };
}

function governingWindow(minute: ApiRateLimitWindow, day: ApiRateLimitWindow): ApiRateLimitWindow {
  const minuteRatio = minute.remaining / minute.limit;
  const dayRatio = day.remaining / day.limit;
  if (minuteRatio !== dayRatio) return minuteRatio < dayRatio ? minute : day;
  return minute.reset <= day.reset ? minute : day;
}

function bucketKind(profile: ApiV1RateLimitProfile, kind: ApiRateLimitWindow["kind"]): string {
  return `${profile}-${kind}`;
}

function validateTokenId(value: string): void {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new Error("The durable API rate-limit token identity is invalid.");
  }
}

function validateCleanupLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new Error("The durable API rate-limit cleanup limit is invalid.");
  }
}
