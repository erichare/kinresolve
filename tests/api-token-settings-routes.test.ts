import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ getSessionContext: vi.fn() }));
const tokenMocks = vi.hoisted(() => ({
  createApiTokenForOwner: vi.fn(),
  listApiTokensForOwner: vi.fn(),
  revokeApiTokenForOwner: vi.fn()
}));
const observabilityMocks = vi.hoisted(() => ({ emitOperationalEvent: vi.fn() }));

vi.mock("@/lib/auth-session", () => ({ getSessionContext: authMocks.getSessionContext }));
vi.mock("@/lib/beta-api-tokens", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/beta-api-tokens")>()),
  ...tokenMocks
}));
vi.mock("@/lib/observability", () => ({ emitOperationalEvent: observabilityMocks.emitOperationalEvent }));

import { DELETE } from "@/app/api/settings/api-tokens/[id]/route";
import { GET, POST } from "@/app/api/settings/api-tokens/route";
import { BetaApiTokenError } from "@/lib/beta-api-tokens";

const tokenId = "a4a17f15-b49a-4c42-872f-a76f38ad23ac";
const metadata = {
  id: tokenId,
  archiveId: "archive-private",
  userId: "owner-1",
  name: "Quickstart",
  prefix: "kr_beta_abcdefgh",
  scopes: ["archive:read"] as const,
  createdAt: new Date("2026-07-15T00:00:00.000Z"),
  expiresAt: new Date("2026-08-14T00:00:00.000Z"),
  lastUsedAt: null,
  revokedAt: null
};

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.getSessionContext.mockResolvedValue({
    userId: "owner-1",
    email: "owner@example.test",
    name: "Owner",
    role: "owner",
    archiveId: "archive-private"
  });
  tokenMocks.listApiTokensForOwner.mockResolvedValue([metadata]);
  tokenMocks.createApiTokenForOwner.mockResolvedValue({
    ...metadata,
    token: `kr_beta_${"a".repeat(43)}`
  });
  tokenMocks.revokeApiTokenForOwner.mockResolvedValue({
    ...metadata,
    revokedAt: new Date("2026-07-15T01:00:00.000Z")
  });
  observabilityMocks.emitOperationalEvent.mockResolvedValue({});
});

describe("owner API token settings routes", () => {
  it("lists metadata without ever serializing a bearer token or digest", async () => {
    const response = await GET(new Request("https://app.kinresolve.com/api/settings/api-tokens"));
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body).toContain("kr_beta_abcdefgh");
    expect(body).not.toMatch(/kr_beta_[A-Za-z0-9_-]{43}|digest/);
    expect(body).not.toContain("owner-1");
    expect(body).not.toContain("archive-private");
  });

  it("creates a least-privilege token and displays the secret once", async () => {
    const response = await POST(new Request("https://app.kinresolve.com/api/settings/api-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Quickstart",
        scopes: ["archive:read"],
        expiresAt: "2026-08-14T00:00:00.000Z"
      })
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      token: `kr_beta_${"a".repeat(43)}`,
      metadata: { id: tokenId, prefix: "kr_beta_abcdefgh" }
    });
    expect(tokenMocks.createApiTokenForOwner).toHaveBeenCalledWith(expect.objectContaining({
      archiveId: "archive-private",
      userId: "owner-1",
      scopes: ["archive:read"]
    }));
  });

  it("requires explicit confirmation for the full archive export scope", async () => {
    const response = await POST(new Request("https://app.kinresolve.com/api/settings/api-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Exporter",
        scopes: ["archive:export"],
        expiresAt: "2026-08-14T00:00:00.000Z"
      })
    }));

    expect(response.status).toBe(400);
    expect(tokenMocks.createApiTokenForOwner).not.toHaveBeenCalled();
  });

  it("returns a safe conflict when the archive token inventory is full", async () => {
    tokenMocks.createApiTokenForOwner.mockRejectedValueOnce(
      new BetaApiTokenError("LIMIT_EXCEEDED")
    );
    const response = await POST(new Request("https://app.kinresolve.com/api/settings/api-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "One too many",
        scopes: ["archive:read"],
        expiresAt: "2026-08-14T00:00:00.000Z"
      })
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "The archive has reached its API token inventory limit."
    });
  });

  it("revokes immediately and emits only token identity telemetry", async () => {
    const response = await DELETE(
      new Request(`https://app.kinresolve.com/api/settings/api-tokens/${tokenId}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: tokenId }) }
    );

    expect(response.status).toBe(200);
    expect(tokenMocks.revokeApiTokenForOwner).toHaveBeenCalledWith({
      archiveId: "archive-private",
      userId: "owner-1",
      tokenId,
      requestId: expect.any(String)
    });
    expect(observabilityMocks.emitOperationalEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: "api_token_revoked",
      tokenId
    }));
  });

  it("denies admins before token storage is queried", async () => {
    authMocks.getSessionContext.mockResolvedValue({
      userId: "admin-1",
      email: "admin@example.test",
      name: "Admin",
      role: "admin",
      archiveId: "archive-private"
    });

    const response = await GET(new Request("https://app.kinresolve.com/api/settings/api-tokens"));

    expect(response.status).toBe(403);
    expect(tokenMocks.listApiTokensForOwner).not.toHaveBeenCalled();
  });
});
