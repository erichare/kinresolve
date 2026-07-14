import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSessionContext: vi.fn()
}));

vi.mock("@/lib/auth-session", () => ({
  getSessionContext: authMocks.getSessionContext
}));

import { requirePermission, withPermission, type AuthorizedRequestContext } from "@/lib/api-authorization";

const viewerSession = {
  userId: "viewer-1",
  email: "viewer@example.com",
  name: "Viewer",
  role: "viewer" as const,
  archiveId: "archive-default"
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("API permission enforcement", () => {
  it("returns a consistent 401 for anonymous or membership-less callers", async () => {
    authMocks.getSessionContext.mockResolvedValue(null);

    const result = await requirePermission(
      new Request("https://app.kinresolve.com/api/settings/archive"),
      "settings:manage"
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected authorization failure");
    expect(result.response.status).toBe(401);
    expect(result.response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    await expect(result.response.json()).resolves.toEqual({ error: "Authentication required" });
  });

  it("returns 403 without exposing actor or archive details", async () => {
    authMocks.getSessionContext.mockResolvedValue(viewerSession);

    const result = await requirePermission(
      new Request("https://app.kinresolve.com/api/settings/archive"),
      "settings:manage"
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected authorization failure");
    expect(result.response.status).toBe(403);
    await expect(result.response.json()).resolves.toEqual({ error: "Permission denied" });
  });

  it("returns the session-derived actor, archive, role, and server request ID", async () => {
    authMocks.getSessionContext.mockResolvedValue(viewerSession);

    const result = await requirePermission(
      new Request("https://app.kinresolve.com/api/people"),
      "archive:read-private"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected authorization success");
    expect(result.context).toMatchObject(viewerSession);
    expect(result.context.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("does not invoke a wrapped handler when permission is denied", async () => {
    authMocks.getSessionContext.mockResolvedValue(viewerSession);
    const handler = vi.fn(async () => Response.json({ changed: true }));
    const wrapped = withPermission("settings:manage", handler);
    const request = new Request("https://app.kinresolve.com/api/settings/archive", {
      method: "PATCH",
      body: "not-json"
    });

    const response = await wrapped(request);

    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes the authorized context to a wrapped handler", async () => {
    authMocks.getSessionContext.mockResolvedValue(viewerSession);
    const handler = vi.fn(async (_request: Request, context: AuthorizedRequestContext) =>
      Response.json({ role: context.role, archiveId: context.archiveId })
    );
    const wrapped = withPermission("archive:read-private", handler);

    const response = await wrapped(new Request("https://app.kinresolve.com/api/people"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    await expect(response.json()).resolves.toEqual({ role: "viewer", archiveId: "archive-default" });
    expect(handler).toHaveBeenCalledOnce();
  });
});
