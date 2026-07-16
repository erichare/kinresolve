import { describe, expect, it } from "vitest";

import {
  publicDemoAiLimits,
  publicDemoAiPrompts,
  reservePublicDemoAiAttempt
} from "@/lib/public-demo-ai-policy";

describe("public demo AI policy", () => {
  it("exposes only three server-owned prompt identifiers", () => {
    expect(Object.keys(publicDemoAiPrompts).sort()).toEqual([
      "case_next_steps",
      "dna_cluster_summary",
      "evidence_gaps"
    ]);
    for (const prompt of Object.values(publicDemoAiPrompts)) {
      expect(prompt.length).toBeGreaterThan(20);
      expect(prompt.length).toBeLessThanOrEqual(1200);
    }
  });

  it("pins the session, global, concurrency, timeout, and output limits", () => {
    expect(publicDemoAiLimits).toEqual({
      attemptsPerSession: 3,
      attemptsPerDay: 150,
      concurrentCalls: 5,
      timeoutMs: 20_000,
      maximumOutputTokens: 800
    });
  });

  it("debits a session and daily attempt only after global capacity is available", () => {
    expect(reservePublicDemoAiAttempt({ sessionAttempts: 1, dailyAttempts: 12, activeCalls: 2 })).toEqual({
      allowed: true,
      sessionAttempts: 2,
      dailyAttempts: 13,
      activeCalls: 3,
      remainingSessionAttempts: 1
    });
    expect(reservePublicDemoAiAttempt({ sessionAttempts: 1, dailyAttempts: 150, activeCalls: 0 })).toEqual({
      allowed: false,
      reason: "daily-limit",
      retryAfterSeconds: 3600
    });
    expect(reservePublicDemoAiAttempt({ sessionAttempts: 1, dailyAttempts: 12, activeCalls: 5 })).toEqual({
      allowed: false,
      reason: "concurrency-limit",
      retryAfterSeconds: 5
    });
  });

  it("does not admit a fourth provider attempt in the same sandbox", () => {
    expect(reservePublicDemoAiAttempt({ sessionAttempts: 3, dailyAttempts: 12, activeCalls: 0 })).toEqual({
      allowed: false,
      reason: "session-limit",
      retryAfterSeconds: 0
    });
  });
});
