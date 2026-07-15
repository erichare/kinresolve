import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  query: vi.fn(),
  signOut: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: mocks.getSession, signOut: mocks.signOut } })
}));
vi.mock("@/lib/db", () => ({ withTransaction: mocks.withTransaction }));

import { POST } from "@/app/api/auth/logout/route";

function request() {
  return new NextRequest("https://app.kinresolve.com/api/auth/logout", {
    method: "POST",
    headers: {
      cookie: "better-auth.session_token=private-session-token",
      origin: "https://app.kinresolve.com",
      "sec-fetch-site": "same-origin"
    }
  });
}

describe("logout route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      session: { id: "session-current" },
      user: { id: "user-current" }
    });
    mocks.signOut.mockResolvedValue(new Response(null, {
      status: 200,
      headers: {
        "set-cookie": "better-auth.session_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax"
      }
    }));
    mocks.query.mockImplementation(async (sql: string) => (
      sql.startsWith("SELECT") ? { rows: [{ count: "0" }], rowCount: 1 } : { rows: [], rowCount: 1 }
    ));
    mocks.withTransaction.mockImplementation(async (_options, callback) => callback({ query: mocks.query }));
  });

  it("explicitly removes the exact session when Better Auth reports success but leaves it behind", async () => {
    const response = await POST(request());

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.getSetCookie()).toEqual([
      "better-auth.session_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax"
    ]);
    expect(await response.text()).toBe("");
    expect(mocks.query).toHaveBeenNthCalledWith(
      1,
      'DELETE FROM public."session" WHERE id = $1 AND "userId" = $2',
      ["session-current", "user-current"]
    );
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      'SELECT count(*)::text AS count FROM public."session" WHERE id = $1 AND "userId" = $2',
      ["session-current", "user-current"]
    );
    expect(mocks.signOut).toHaveBeenCalledWith(expect.objectContaining({ asResponse: true }));
  });

  it("returns 204 when the exact current session is already absent", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mocks.query.mockResolvedValueOnce({ rows: [{ count: "0" }], rowCount: 1 });

    const response = await POST(request());
    expect(response.status).toBe(204);
  });

  it("clears an already-sessionless browser without issuing an unscoped database delete", async () => {
    mocks.getSession.mockResolvedValueOnce(null);

    const response = await POST(request());
    expect(response.status).toBe(204);
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it.each(["exception", "non-success response"])("fails closed on a Better Auth %s", async (failure) => {
    if (failure === "exception") {
      mocks.signOut.mockRejectedValueOnce(new Error("private adapter marker"));
    } else {
      mocks.signOut.mockResolvedValueOnce(new Response(null, { status: 503 }));
    }

    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).not.toContain("private adapter marker");
  });

  it.each(["delete failure", "failed absence verification"])("returns private 503 on %s", async (failure) => {
    if (failure === "delete failure") {
      mocks.query.mockRejectedValueOnce(new Error("private database marker"));
    } else {
      mocks.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      mocks.query.mockResolvedValueOnce({ rows: [{ count: "1" }], rowCount: 1 });
    }

    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).not.toContain("private database marker");
  });
});
