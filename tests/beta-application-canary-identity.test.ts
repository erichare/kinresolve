import { describe, expect, it } from "vitest";

import { resolveBetaApplicationCanaryEmail } from "@/scripts/beta-application-canary-identity";

describe("beta application release canary identity", () => {
  it("derives a unique controlled-sink address for each phase, run, and attempt", () => {
    const pattern = "kinresolve-canary+{token}@sink.example";
    const staging = resolveBetaApplicationCanaryEmail({
      pattern,
      phase: "staging",
      runAttempt: "2",
      runId: "123456"
    });
    const production = resolveBetaApplicationCanaryEmail({
      pattern,
      phase: "production",
      runAttempt: "2",
      runId: "123456"
    });
    const rerun = resolveBetaApplicationCanaryEmail({
      pattern,
      phase: "staging",
      runAttempt: "3",
      runId: "123456"
    });

    expect(staging).toBe("kinresolve-canary+staging-run-123456-attempt-2@sink.example");
    expect(new Set([staging, production, rerun]).size).toBe(3);
  });

  it.each([
    ["missing placeholder", "canary@sink.example", "staging", "1", "1"],
    ["multiple placeholders", "{token}+{token}@sink.example", "staging", "1", "1"],
    ["uppercase pattern", "Canary+{token}@sink.example", "staging", "1", "1"],
    ["invalid phase", "canary+{token}@sink.example", "preview", "1", "1"],
    ["zero run", "canary+{token}@sink.example", "staging", "1", "0"],
    ["zero attempt", "canary+{token}@sink.example", "staging", "0", "1"],
    ["invalid address", "canary+{token}@sink..example", "staging", "1", "1"],
    ["invalid local part", ".{token}@sink.example", "staging", "1", "1"]
  ])("rejects %s without echoing the configured address", (_label, pattern, phase, runAttempt, runId) => {
    let message = "";
    try {
      resolveBetaApplicationCanaryEmail({ pattern, phase, runAttempt, runId });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("Beta intake release canary identity configuration is invalid.");
    expect(message).not.toContain(pattern);
  });
});
