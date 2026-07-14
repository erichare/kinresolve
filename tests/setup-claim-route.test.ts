import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSessionContext: vi.fn()
}));

vi.mock("@/lib/auth-session", () => ({
  getSessionContext: authMocks.getSessionContext
}));

import { POST } from "@/app/api/setup/claim/route";

const request = () => new Request("https://app.kinresolve.com/api/setup/claim", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setup claim route", () => {
  it("returns the shared private 401 contract when no archive membership resolves", async () => {
    authMocks.getSessionContext.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required" });
  });

  it("returns only the session-derived setup context", async () => {
    authMocks.getSessionContext.mockResolvedValue({
      userId: "owner-1",
      email: "owner@example.com",
      name: "Owner",
      role: "owner",
      archiveId: "archive-default"
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ role: "owner", archiveId: "archive-default" });
  });
});
