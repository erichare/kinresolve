import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaceMocks = vi.hoisted(() => ({
  updatePersonCuration: vi.fn()
}));
const authMocks = vi.hoisted(() => ({
  getSessionContext: vi.fn()
}));
const capabilityMocks = vi.hoisted(() => ({
  resolveHostedCapabilities: vi.fn()
}));

vi.mock("@/lib/workspace-store", () => workspaceMocks);
vi.mock("@/lib/auth-session", () => authMocks);
vi.mock("@/lib/hosted-capabilities", () => capabilityMocks);

import { PATCH } from "@/app/api/people/[id]/curation/route";

const ownerSession = {
  userId: "owner-private-beta",
  email: "owner@example.test",
  name: "Owner",
  role: "owner" as const,
  archiveId: "archive-private-beta"
};

beforeEach(() => {
  vi.resetAllMocks();
  authMocks.getSessionContext.mockResolvedValue(ownerSession);
  capabilityMocks.resolveHostedCapabilities.mockReturnValue({ publicPublishing: true });
});

describe("person curation route validation", () => {
  it.each(["true", 1, null, {}, []])("rejects non-boolean published value %j", async (published) => {
    const response = await PATCH(request({ published }), routeContext());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid published value" });
    expect(workspaceMocks.updatePersonCuration).not.toHaveBeenCalled();
  });

  it("passes a real boolean through with the authorized archive", async () => {
    workspaceMocks.updatePersonCuration.mockResolvedValue({ id: "person-1", published: false });

    const response = await PATCH(request({ published: false }), routeContext());

    expect(response.status).toBe(200);
    expect(workspaceMocks.updatePersonCuration).toHaveBeenCalledWith(
      "person-1",
      { published: false },
      { archiveId: "archive-private-beta" }
    );
  });

  it("fails closed before mutation when hosted public publishing is disabled", async () => {
    capabilityMocks.resolveHostedCapabilities.mockReturnValue({ publicPublishing: false });

    const response = await PATCH(request({ published: true }), routeContext());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Person not found" });
    expect(workspaceMocks.updatePersonCuration).not.toHaveBeenCalled();
  });

  it("still allows unpublishing and non-publishing curation while publishing is disabled", async () => {
    capabilityMocks.resolveHostedCapabilities.mockReturnValue({ publicPublishing: false });
    workspaceMocks.updatePersonCuration.mockResolvedValue({ id: "person-1", published: false });

    const response = await PATCH(
      request({ published: false, privacy: "sensitive", livingStatus: "living" }),
      routeContext()
    );

    expect(response.status).toBe(200);
    expect(workspaceMocks.updatePersonCuration).toHaveBeenCalledWith(
      "person-1",
      { published: false, privacy: "sensitive", livingStatus: "living" },
      { archiveId: "archive-private-beta" }
    );
  });
});

function request(body: unknown): Request {
  return new Request("https://app.kinresolve.com/api/people/person-1/curation", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function routeContext() {
  return { params: Promise.resolve({ id: "person-1" }) };
}
