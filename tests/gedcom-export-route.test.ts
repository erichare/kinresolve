import { afterEach, describe, expect, it, vi } from "vitest";

const workspaceMocks = vi.hoisted(() => ({
  readWorkspace: vi.fn()
}));

vi.mock("@/lib/workspace-store", () => workspaceMocks);
vi.mock("@/lib/auth-session", () => ({
  getSessionContext: vi.fn(async () => ({
    userId: "owner-1",
    email: "owner@example.com",
    name: "Owner",
    role: "owner",
    archiveId: "archive-default"
  }))
}));

import { GET } from "@/app/api/exports/gedcom/route";

const request = () => new Request("https://app.kinresolve.com/api/exports/gedcom");

afterEach(() => {
  vi.clearAllMocks();
});

describe("GEDCOM export route", () => {
  it("returns the archive as a downloadable GEDCOM file", async () => {
    workspaceMocks.readWorkspace.mockResolvedValue({
      archiveName: "Hartwell–Mercer Family Archive",
      people: [],
      rawRecords: [],
      imports: []
    });

    const response = await GET(request());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="hartwell-mercer-family-archive-\d{4}-\d{2}-\d{2}\.ged"$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.startsWith("0 HEAD")).toBe(true);
    expect(body.trimEnd().endsWith("0 TRLR")).toBe(true);
    expect(workspaceMocks.readWorkspace).toHaveBeenCalledWith({ archiveId: "archive-default" });
  });

  it("returns a friendly error when the workspace cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    workspaceMocks.readWorkspace.mockRejectedValue(new Error("database unreachable"));

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain("GEDCOM export failed");
    expect(body.error).not.toContain("database unreachable");
  });
});
