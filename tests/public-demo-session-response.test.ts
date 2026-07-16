import { describe, expect, it } from "vitest";

import { projectPublicDemoSession } from "@/lib/public-demo-session-response";

describe("public demo session response", () => {
  it("keeps server-only identity and archive-generation fields out of public DTOs", () => {
    const response = projectPublicDemoSession({
      sessionId: "11111111-1111-4111-8111-111111111111",
      archiveId: "demo-11111111111111111111111111111111",
      generation: 3,
      expiresAt: "2026-07-17T12:00:00.000Z",
      status: "active",
      resetCount: 2,
      aiAttemptsRemaining: 1
    });

    expect(response).toEqual({
      expiresAt: "2026-07-17T12:00:00.000Z",
      status: "active",
      resetCount: 2,
      aiAttemptsRemaining: 1
    });
    expect(response).not.toHaveProperty("sessionId");
    expect(response).not.toHaveProperty("archiveId");
    expect(response).not.toHaveProperty("generation");
  });
});
