import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  demoGuestCan,
  type DemoGuestCapability
} from "@/lib/public-demo-capabilities";
import {
  resolveApiAccess,
  resolveApiMethodPolicy
} from "@/lib/api-access";

const root = process.cwd();

async function source(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

describe("public demo API boundary", () => {
  it("grants broad reads and synthetic export without granting generic mutations", () => {
    const allowed: DemoGuestCapability[] = [
      "archive:read-private",
      "cases:read",
      "dna:read",
      "archive:export",
      "demo:guide",
      "demo:sample-import",
      "demo:ai",
      "demo:feedback",
      "demo:session-control"
    ];
    const denied = [
      "cases:write",
      "evidence:write",
      "sources:write",
      "dna:write",
      "archive:publish",
      "imports:manage",
      "api-tokens:manage",
      "settings:manage",
      "users:manage"
    ] as const;

    for (const capability of allowed) expect(demoGuestCan(capability), capability).toBe(true);
    for (const capability of denied) expect(demoGuestCan(capability), capability).toBe(false);
  });

  it("registers every demo endpoint with an explicit public or demo-session policy", () => {
    expect(resolveApiAccess("/api/demo/sessions", "POST")).toEqual({ kind: "public" });
    expect(resolveApiMethodPolicy("/api/demo/sessions", "POST")).toBe("same-origin-cookie");

    for (const [pathname, method, capability, policy] of [
      ["/api/demo/session", "GET", "demo:session-control", "read-only"],
      ["/api/demo/session/reset", "POST", "demo:session-control", "same-origin-cookie"],
      ["/api/demo/session/end", "POST", "demo:session-control", "same-origin-cookie"],
      ["/api/demo/cases/case-mercer-march-identity/guide", "POST", "demo:guide", "same-origin-cookie"],
      ["/api/demo/sample-import", "POST", "demo:sample-import", "same-origin-cookie"],
      ["/api/demo/ai", "POST", "demo:ai", "same-origin-cookie"],
      ["/api/demo/feedback", "POST", "demo:feedback", "same-origin-cookie"]
    ] as const) {
      expect(resolveApiAccess(pathname, method), `${method} ${pathname}`).toEqual({
        kind: "demo-session",
        capability
      });
      expect(resolveApiMethodPolicy(pathname, method), `${method} ${pathname}`).toBe(policy);
    }
  });

  it("keeps the guide and AI payloads server-owned and free of arbitrary text", async () => {
    const [guide, ai] = await Promise.all([
      source("app/api/demo/cases/[caseId]/guide/route.ts"),
      source("app/api/demo/ai/route.ts")
    ]);

    expect(guide).toContain("record_outcome");
    expect(guide).toContain("hypothesis_decision");
    expect(guide).toMatch(/z\.enum\(\[\s*["']found["'],\s*["']not_found["'],\s*["']inconclusive["']/);
    expect(guide).not.toMatch(/note\s*:\s*z\.string/);
    expect(guide).not.toMatch(/reason\s*:\s*z\.string/);

    expect(ai).toContain("case_next_steps");
    expect(ai).toContain("evidence_gaps");
    expect(ai).toContain("dna_cluster_summary");
    expect(ai).not.toMatch(/question\s*:\s*z\.string/);
  });

  it("uses a strict structured feedback schema with no free-text field", async () => {
    const feedback = await source("app/api/demo/feedback/route.ts");

    expect(feedback).toContain("usefulness");
    expect(feedback).toContain("clarity");
    expect(feedback).toContain("featureInterest");
    expect(feedback).toContain("betaInterest");
    expect(feedback).toContain(".strict()");
    expect(feedback).not.toMatch(/comment|message|notes?|text\s*:/i);
  });
});
