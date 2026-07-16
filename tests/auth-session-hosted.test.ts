import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureWorkspaceProvisioned: vi.fn(),
  getArchiveId: vi.fn(() => "archive-beta"),
  getSession: vi.fn(),
  isHostedDeployment: vi.fn(() => true),
  query: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: mocks.getSession } })
}));

vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/hosted-config", () => ({ isHostedDeployment: mocks.isHostedDeployment }));
vi.mock("@/lib/workspace-store", () => ({
  ensureWorkspaceProvisioned: mocks.ensureWorkspaceProvisioned,
  getArchiveId: mocks.getArchiveId
}));

import { getSessionContext } from "@/lib/auth-session";

describe("hosted session authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_SECRET", "hosted-test-secret");
    mocks.isHostedDeployment.mockReturnValue(true);
    mocks.getSession.mockResolvedValue({
      user: {
        id: "user-beta",
        email: "participant@example.com",
        name: "Participant",
        emailVerified: true
      }
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects an unverified hosted account before membership lookup", async () => {
    mocks.getSession.mockResolvedValue({
      user: {
        id: "user-beta",
        email: "participant@example.com",
        name: "Participant",
        emailVerified: false
      }
    });

    await expect(getSessionContext(new Headers())).resolves.toBeNull();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("requires a consumed invitation and its immutable legal acceptance", async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await expect(getSessionContext(new Headers())).resolves.toBeNull();
    expect(mocks.query).toHaveBeenCalledOnce();
    const [sql, values] = mocks.query.mock.calls[0];
    expect(sql).toContain("beta_terms_acceptances");
    expect(sql).toContain("invitation.state = 'consumed'");
    expect(values).toEqual(["archive-beta", "user-beta"]);
  });

  it("returns a context only for the invitation-backed exact acceptance", async () => {
    mocks.query.mockResolvedValue({ rows: [{ role: "viewer" }] });

    await expect(getSessionContext(new Headers())).resolves.toEqual({
      kind: "member",
      userId: "user-beta",
      email: "participant@example.com",
      name: "Participant",
      role: "viewer",
      archiveId: "archive-beta"
    });
  });

  it("does not lock out an accepted cohort when a later release manifest changes", async () => {
    vi.stubEnv("KINRESOLVE_BETA_LEGAL_STATUS", "pending-reapproval");
    mocks.query.mockResolvedValue({ rows: [{ role: "viewer" }] });

    await expect(getSessionContext(new Headers())).resolves.toMatchObject({
      userId: "user-beta",
      role: "viewer"
    });
    expect(mocks.query).toHaveBeenCalledOnce();
  });
});
