import { describe, expect, it } from "vitest";

import { apiRateLimitPolicies } from "@/lib/durable-api-rate-limit";

describe("durable API rate-limit contract", () => {
  it("pins the public and export quotas to independent minute and day windows", () => {
    expect(apiRateLimitPolicies).toEqual({
      standard: [
        { kind: "minute", maximumRequests: 60, windowSeconds: 60 },
        { kind: "day", maximumRequests: 10_000, windowSeconds: 86_400 }
      ],
      export: [
        { kind: "minute", maximumRequests: 1, windowSeconds: 60 },
        { kind: "day", maximumRequests: 10, windowSeconds: 86_400 }
      ]
    });
  });
});
