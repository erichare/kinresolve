import { describe, expect, it } from "vitest";

import {
  deriveAuthRateLimitBucketDigest,
  isAuthRateLimitDigest
} from "@/lib/durable-auth-rate-limit";

const secret = "a-private-rate-limit-secret-with-more-than-32-bytes";

describe("durable auth rate-limit identity", () => {
  it("stores a deterministic domain-separated HMAC instead of the raw subject", () => {
    const first = deriveAuthRateLimitBucketDigest({
      hmacSecret: secret,
      scope: "beta/accept",
      subject: "pilot@example.com"
    });
    const same = deriveAuthRateLimitBucketDigest({
      hmacSecret: secret,
      scope: "beta/accept",
      subject: "pilot@example.com"
    });
    const otherScope = deriveAuthRateLimitBucketDigest({
      hmacSecret: secret,
      scope: "beta/inspect",
      subject: "pilot@example.com"
    });

    expect(first).toBe(same);
    expect(first).not.toBe(otherScope);
    expect(first).not.toContain("pilot");
    expect(isAuthRateLimitDigest(first)).toBe(true);
  });

  it("rejects weak secrets and malformed scopes", () => {
    expect(() => deriveAuthRateLimitBucketDigest({
      hmacSecret: "too-short",
      scope: "beta/accept",
      subject: "pilot@example.com"
    })).toThrow(/32 bytes/);
    expect(() => deriveAuthRateLimitBucketDigest({
      hmacSecret: secret,
      scope: "Beta Accept",
      subject: "pilot@example.com"
    })).toThrow(/scope/);
  });
});
