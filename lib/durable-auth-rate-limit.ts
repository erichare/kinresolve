import { createHmac } from "node:crypto";
import type { PoolClient } from "pg";

import { withTransaction, type DatabaseOptions } from "./db";

const digestDomain = "kinresolve-auth-rate-limit-v1";
const scopePattern = /^[a-z0-9][a-z0-9:/_-]{0,79}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

export type DurableAuthRateLimitPolicy = {
  maximumRequests: number;
  scope: string;
  windowSeconds: number;
};

export type DurableAuthRateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export type ConsumeDurableAuthRateLimitInput = DurableAuthRateLimitPolicy & {
  hmacSecret: string;
  subject: string;
};

export function deriveAuthRateLimitBucketDigest(input: {
  hmacSecret: string;
  scope: string;
  subject: string;
}): string {
  validateHmacSecret(input.hmacSecret);
  validateScope(input.scope);
  validateSubject(input.subject);
  return createHmac("sha256", input.hmacSecret)
    .update(digestDomain, "utf8")
    .update("\0", "utf8")
    .update(input.scope, "utf8")
    .update("\0", "utf8")
    .update(input.subject, "utf8")
    .digest("hex");
}

export async function consumeDurableAuthRateLimit(
  input: ConsumeDurableAuthRateLimitInput,
  options: DatabaseOptions = {}
): Promise<DurableAuthRateLimitResult> {
  validatePolicy(input);
  const bucketDigest = deriveAuthRateLimitBucketDigest(input);
  return withTransaction(options, (client) => consumeBucket(client, bucketDigest, input));
}

export async function cleanupExpiredAuthRateLimits(
  input: { limit?: number } = {},
  options: DatabaseOptions = {}
): Promise<number> {
  const limit = input.limit ?? 500;
  validateCleanupLimit(limit);
  return withTransaction(options, (client) => cleanupExpiredAuthRateLimitsInTransaction(client, limit));
}

export async function cleanupExpiredAuthRateLimitsInTransaction(
  client: PoolClient,
  limit: number
): Promise<number> {
  validateCleanupLimit(limit);
  const result = await client.query(
    `WITH expired AS (
       SELECT ctid
       FROM public.auth_rate_limit_buckets
       WHERE expires_at <= now()
       ORDER BY expires_at, bucket_digest
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     DELETE FROM public.auth_rate_limit_buckets AS bucket
     USING expired
     WHERE bucket.ctid = expired.ctid`,
    [limit]
  );
  return result.rowCount ?? 0;
}

async function consumeBucket(
  client: PoolClient,
  bucketDigest: string,
  policy: DurableAuthRateLimitPolicy
): Promise<DurableAuthRateLimitResult> {
  const windowMilliseconds = policy.windowSeconds * 1000;
  const inserted = await client.query(
    `INSERT INTO public.auth_rate_limit_buckets (
       bucket_digest, request_count, window_started_at, expires_at, updated_at
     )
     VALUES ($1, 1, now(), now() + ($2::bigint * interval '1 millisecond'), now())
     ON CONFLICT (bucket_digest) DO NOTHING`,
    [bucketDigest, windowMilliseconds]
  );

  if (inserted.rowCount === 1) {
    return {
      allowed: true,
      remaining: policy.maximumRequests - 1,
      retryAfterSeconds: 0
    };
  }

  const locked = await client.query<{
    expired: boolean;
    request_count: number;
    retry_after_seconds: number;
  }>(
    `SELECT request_count,
            expires_at <= now() AS expired,
            GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - now())))::integer) AS retry_after_seconds
     FROM public.auth_rate_limit_buckets
     WHERE bucket_digest = $1
     FOR UPDATE`,
    [bucketDigest]
  );
  const bucket = locked.rows[0];
  if (!bucket) {
    throw new Error("The durable auth rate-limit bucket disappeared during an update.");
  }

  if (bucket.expired) {
    await client.query(
      `UPDATE public.auth_rate_limit_buckets
       SET request_count = 1,
           window_started_at = now(),
           expires_at = now() + ($2::bigint * interval '1 millisecond'),
           updated_at = now()
       WHERE bucket_digest = $1`,
      [bucketDigest, windowMilliseconds]
    );
    return {
      allowed: true,
      remaining: policy.maximumRequests - 1,
      retryAfterSeconds: 0
    };
  }

  if (bucket.request_count >= policy.maximumRequests) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: bucket.retry_after_seconds
    };
  }

  const updated = await client.query<{ request_count: number }>(
    `UPDATE public.auth_rate_limit_buckets
     SET request_count = request_count + 1,
         updated_at = now()
     WHERE bucket_digest = $1
     RETURNING request_count`,
    [bucketDigest]
  );
  const count = updated.rows[0]?.request_count;
  if (!count) {
    throw new Error("The durable auth rate-limit bucket could not be updated.");
  }
  return {
    allowed: true,
    remaining: Math.max(0, policy.maximumRequests - count),
    retryAfterSeconds: 0
  };
}

function validatePolicy(policy: DurableAuthRateLimitPolicy): void {
  validateScope(policy.scope);
  if (!Number.isSafeInteger(policy.maximumRequests) || policy.maximumRequests < 1 || policy.maximumRequests > 10_000) {
    throw new Error("The durable auth rate-limit request maximum is invalid.");
  }
  if (!Number.isSafeInteger(policy.windowSeconds) || policy.windowSeconds < 1 || policy.windowSeconds > 86_400) {
    throw new Error("The durable auth rate-limit window is invalid.");
  }
}

function validateScope(value: string): void {
  if (!scopePattern.test(value)) throw new Error("The durable auth rate-limit scope is invalid.");
}

function validateSubject(value: string): void {
  const byteLength = Buffer.byteLength(value, "utf8");
  if (byteLength < 1 || byteLength > 1024) {
    throw new Error("The durable auth rate-limit subject is invalid.");
  }
}

function validateHmacSecret(value: string): void {
  if (Buffer.byteLength(value, "utf8") < 32) {
    throw new Error("The durable auth rate-limit HMAC secret must be at least 32 bytes.");
  }
}

function validateCleanupLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new Error("The durable auth rate-limit cleanup limit is invalid.");
  }
}

export function isAuthRateLimitDigest(value: string): boolean {
  return sha256Pattern.test(value);
}
