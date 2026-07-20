import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolvePublicDemoConfiguration: vi.fn(),
  readPublicDemoStats: vi.fn()
}));

vi.mock("@/lib/public-demo-config", () => ({
  resolvePublicDemoConfiguration: mocks.resolvePublicDemoConfiguration
}));
vi.mock("@/lib/public-demo-session-store", () => ({
  readPublicDemoStats: mocks.readPublicDemoStats
}));

import { GET } from "@/app/api/public/demo-stats/route";

describe("public demo stats route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolvePublicDemoConfiguration.mockReturnValue({ enabled: true });
    mocks.readPublicDemoStats.mockResolvedValue({
      mysteriesSolved: 42,
      since: "2026-07-16T00:00:00.000Z"
    });
  });

  it("returns 404 without reading the database when the public demo is disabled", async () => {
    mocks.resolvePublicDemoConfiguration.mockReturnValue({ enabled: false });

    const response = await GET();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(mocks.readPublicDemoStats).not.toHaveBeenCalled();
  });

  it("fails closed when the public demo configuration is invalid rather than leaking details", async () => {
    mocks.resolvePublicDemoConfiguration.mockImplementation(() => {
      throw new Error("KINRESOLVE_PUBLIC_DEMO_ENABLED must be exactly true or false.");
    });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "The public demo stats are unavailable."
    });
    expect(mocks.readPublicDemoStats).not.toHaveBeenCalled();
  });

  it("serves the anonymous counter with shared-cache, cross-origin, and no-index headers", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      mysteriesSolved: 42,
      since: "2026-07-16T00:00:00.000Z"
    });
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300"
    );
    expect(response.headers.get("access-control-allow-origin")).toBe("https://kinresolve.com");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("fails closed with an uncacheable 503 when the singleton read fails", async () => {
    mocks.readPublicDemoStats.mockRejectedValue(
      new Error("The public demo stats singleton is unavailable.")
    );

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "The public demo stats are unavailable."
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("retry-after")).toBe("60");
  });
});
