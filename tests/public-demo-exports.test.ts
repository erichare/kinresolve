import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveApiAccess, resolveApiMethodPolicy } from "@/lib/api-access";
import { demoGuestCan } from "@/lib/public-demo-capabilities";

const mocks = vi.hoisted(() => ({
  capabilities: [] as string[],
  readWorkspace: vi.fn()
}));

vi.mock("@/lib/api-authorization", () => ({
  withDemoGuestCapability: (
    capability: string,
    handler: (request: Request, guest: object) => Promise<Response>
  ) => {
    mocks.capabilities.push(capability);
    return (request: Request) => handler(request, {
      kind: "demo-guest",
      sessionId: "11111111-1111-4111-8111-111111111111",
      archiveId: "archive-demo-private",
      generation: 7,
      expiresAt: "2026-07-17T12:00:00.000Z",
      requestId: "request-demo-export"
    });
  }
}));

vi.mock("@/lib/workspace-store", () => ({
  readWorkspace: mocks.readWorkspace
}));

const fixedNow = new Date("2026-07-16T12:00:00.000Z");

describe("public demo synthetic exports", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.capabilities.length = 0;
    mocks.readWorkspace.mockReset();
    mocks.readWorkspace.mockResolvedValue(fictionalWorkspace());
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a dedicated demo-only capability and read-only route registrations", () => {
    expect(demoGuestCan("demo:export" as never)).toBe(true);
    expect(demoGuestCan("archive:export")).toBe(false);

    for (const pathname of [
      "/api/demo/exports/gedcom",
      "/api/demo/exports/research-archive"
    ]) {
      expect(resolveApiAccess(pathname, "GET"), pathname).toEqual({
        kind: "demo-session",
        capability: "demo:export"
      });
      expect(resolveApiMethodPolicy(pathname, "GET"), pathname).toBe("read-only");
      expect(resolveApiAccess(pathname, "POST"), pathname).toBeUndefined();
    }
  });

  it("exports a fictional GEDCOM from only the authenticated archive generation", async () => {
    const { GET } = await import("@/app/api/demo/exports/gedcom/route");
    const response = await GET(request("/api/demo/exports/gedcom"));
    const content = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toMatch(/noindex/i);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("content-disposition")).toMatch(
      /filename="[^"]*fictional[^"]*demo[^"]*\.ged"/i
    );
    expect(content).toMatch(/fictional demo material/i);
    expect(content).toMatch(/^0 HEAD/m);
    expect(content).toMatch(/^0 TRLR/m);
    expect(mocks.readWorkspace).toHaveBeenCalledWith({
      archiveId: "archive-demo-private",
      demoGuestFence: {
        generation: 7,
        sessionId: "11111111-1111-4111-8111-111111111111"
      }
    });
    expect(mocks.capabilities).toContain("demo:export");
  });

  it("exports a fictional research bundle from only the authenticated archive generation", async () => {
    const { GET } = await import("@/app/api/demo/exports/research-archive/route");
    const response = await GET(request("/api/demo/exports/research-archive"));
    const content = await response.text();
    const bundle = JSON.parse(content) as {
      manifest?: { exportType?: string; fictional?: boolean; notice?: string };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toMatch(/noindex/i);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toMatch(
      /filename="[^"]*fictional[^"]*demo[^"]*\.json"/i
    );
    expect(content).toMatch(/fictional demo material/i);
    expect(bundle.manifest).toMatchObject({
      exportType: "fictional-demo-research",
      fictional: true
    });
    expect(mocks.readWorkspace).toHaveBeenCalledWith({
      archiveId: "archive-demo-private",
      demoGuestFence: {
        generation: 7,
        sessionId: "11111111-1111-4111-8111-111111111111"
      }
    });
    expect(mocks.capabilities).toContain("demo:export");
  });

  it.each([
    "/api/demo/exports/gedcom?archiveId=somebody-elses-archive",
    "/api/demo/exports/gedcom?notes=visitor-supplied-text",
    "/api/demo/exports/research-archive?archiveId=somebody-elses-archive",
    "/api/demo/exports/research-archive?message=visitor-supplied-text"
  ])("rejects all visitor-controlled export input: %s", async (pathname) => {
    const route = pathname.includes("gedcom")
      ? await import("@/app/api/demo/exports/gedcom/route")
      : await import("@/app/api/demo/exports/research-archive/route");
    const response = await route.GET(request(pathname));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Demo exports do not accept input" });
    expect(mocks.readWorkspace).not.toHaveBeenCalled();
  });
});

function request(pathname: string): Request {
  return new Request(`https://demo.kinresolve.com${pathname}`, {
    method: "GET",
    headers: { accept: "*/*" }
  });
}

function fictionalWorkspace() {
  return {
    version: 4,
    archiveName: "Hartwell-Mercer fictional demo family",
    archiveTagline: "Entirely fictional research material",
    updatedAt: "2026-07-16T12:00:00.000Z",
    people: [],
    cases: [],
    sources: [],
    dnaMatches: [],
    aiRuns: [],
    imports: [],
    rawRecords: [],
    backups: []
  };
}
