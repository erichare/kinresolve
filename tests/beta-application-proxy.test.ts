import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const fence = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock("@/lib/release-fence", () => ({ getActiveReleaseFence: fence }));
vi.mock("@/lib/auth-session", () => ({ getSessionContext: vi.fn() }));
vi.mock("@/lib/db", () => ({ ensureDatabaseSchema: vi.fn() }));

import { proxy } from "@/proxy";

afterEach(() => {
  vi.clearAllMocks();
  fence.mockResolvedValue(null);
});

function formRequest(method = "POST", extra: Record<string, string> = {}) {
  return new NextRequest("https://app.kinresolve.com/api/public/beta-applications", {
    headers: { origin: "https://kinresolve.com", ...extra },
    method
  });
}

describe("beta application proxy policy", () => {
  it.each([
    ["wrong origin", { origin: "https://evil.example" }],
    ["cookie", { cookie: "session=secret" }],
    ["authorization", { authorization: "Bearer secret" }]
  ])("rejects %s before the release-fence database lookup", async (_label, headers) => {
    const response = await proxy(formRequest("POST", headers));
    expect(response.status).toBe(403);
    expect(fence).not.toHaveBeenCalled();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("lets the exact credentialless marketing form reach its route when writes are open", async () => {
    const response = await proxy(formRequest());
    expect(response.status).toBe(200);
    expect(fence).toHaveBeenCalledOnce();
  });

  it("blocks a valid form with the durable release fence before persistence", async () => {
    fence.mockResolvedValue({
      activatedAt: "2026-07-15T18:00:00.000Z",
      activationGeneration: 1,
      fenceId: "fence-beta-release",
      firstActivatedAt: "2026-07-15T18:00:00.000Z",
      releaseCommitSha: "a".repeat(40),
      releasedAt: null,
      state: "active",
      updatedAt: "2026-07-15T18:00:00.000Z"
    });
    const response = await proxy(formRequest());
    expect(response.status).toBe(423);
  });

  it.each(["GET", "OPTIONS", "PUT"])("keeps %s fail closed with only POST allowed", async (method) => {
    const response = await proxy(formRequest(method));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(fence).not.toHaveBeenCalled();
  });
});
