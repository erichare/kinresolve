import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureWorkspaceProvisioned: vi.fn(),
  getArchiveId: vi.fn(() => "archive-member"),
  getSession: vi.fn(),
  isHostedDeployment: vi.fn(() => true),
  query: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: mocks.getSession } })
}));
vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/hosted-config", () => ({
  isHostedDeployment: mocks.isHostedDeployment,
  resolveDatasetConfiguration: () => ({ deploymentMode: "hosted", datasetMode: "demo" })
}));
vi.mock("@/lib/workspace-store", () => ({
  ensureWorkspaceProvisioned: mocks.ensureWorkspaceProvisioned,
  getArchiveId: mocks.getArchiveId
}));

import { getSessionContext } from "@/lib/auth-session";

const rawToken = "q".repeat(43);
const tokenDigest = createHash("sha256").update(rawToken, "utf8").digest("hex");

describe("discriminated public demo request principal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_SECRET", "public-demo-test-secret");
    vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("KINRESOLVE_DATASET_MODE", "demo");
    vi.stubEnv("KINRESOLVE_PUBLIC_DEMO_ENABLED", "true");
    vi.stubEnv("KINRESOLVE_PUBLIC_DEMO_ORIGIN", "https://demo.kinresolve.com");
    vi.stubEnv("APP_BASE_URL", "https://demo.kinresolve.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves an active opaque-cookie guest without manufacturing a persisted role", async () => {
    mocks.getSession.mockResolvedValue(null);
    mocks.query.mockResolvedValue({
      rows: [{
        session_id: "demo-session-1",
        archive_id: "demo-archive-1",
        generation: 2,
        expires_at: "2026-07-17T16:00:00.000Z",
        ai_attempts_used: 1,
        reset_count: 1,
        status: "active"
      }]
    });
    const headers = new Headers({
      cookie: `__Host-kinresolve-demo=${rawToken}`
    });

    const principal = await getSessionContext(headers);

    expect(principal).toMatchObject({
      kind: "demo-guest",
      sessionId: "demo-session-1",
      archiveId: "demo-archive-1",
      generation: 2,
      expiresAt: "2026-07-17T16:00:00.000Z"
    });
    expect(principal).not.toHaveProperty("role");
    expect(principal).not.toHaveProperty("userId");

    const queryValues = mocks.query.mock.calls.flatMap((call) =>
      Array.isArray(call[1]) ? call[1] : []
    );
    expect(queryValues).toContain(tokenDigest);
    expect(queryValues).not.toContain(rawToken);
  });

  it("keeps authenticated archive members on the member branch", async () => {
    mocks.getSession.mockResolvedValue({
      user: {
        id: "member-1",
        email: "member@example.com",
        name: "Member",
        emailVerified: true
      }
    });
    mocks.query.mockResolvedValue({ rows: [{ role: "viewer" }] });

    await expect(getSessionContext(new Headers())).resolves.toEqual({
      kind: "member",
      userId: "member-1",
      email: "member@example.com",
      name: "Member",
      role: "viewer",
      archiveId: "archive-member"
    });
  });

  it("does not add demo-guest to the persisted membership Role union", async () => {
    const models = await readFile(path.join(process.cwd(), "lib/models.ts"), "utf8");
    const roleDeclaration = models.match(/export type Role\s*=\s*([^;]+);/)?.[1] ?? "";

    expect(roleDeclaration).toContain('"owner"');
    expect(roleDeclaration).toContain('"viewer"');
    expect(roleDeclaration).not.toContain("demo-guest");
  });

  it("authenticates demo guests only through the fail-closed hosted-demo resolver", async () => {
    const authSession = await readFile(path.join(process.cwd(), "lib/auth-session.ts"), "utf8");

    expect(authSession).toContain("resolvePublicDemoConfiguration");
    expect(authSession).not.toMatch(/process\.env\.KINRESOLVE_PUBLIC_DEMO_ENABLED\s*===\s*["']true["']/);
  });
});
