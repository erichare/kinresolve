import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("public demo aggregate analytics", () => {
  it("records a fixed landing event without a browser or third-party identifier", async () => {
    const landing = await source("app/page.tsx");

    expect(landing).toContain('eventName: "landing_viewed"');
    expect(landing).toContain("recordPublicDemoEvent");
    expect(landing).not.toMatch(/posthog|segment|google-analytics|gtag|mixpanel/i);
  });

  it("accepts only the fixed beta CTA event for an authenticated demo session", async () => {
    const [route, registry] = await Promise.all([
      source("app/api/demo/events/route.ts"),
      source("lib/api-access.ts")
    ]);

    expect(route).toMatch(/z\.object\(\{[\s\S]*eventName:\s*z\.literal\(["']beta_cta_clicked["']\)[\s\S]*\}\)\.strict\(\)/);
    expect(route).toContain('withDemoGuestCapability("demo:analytics"');
    expect(route).toContain('eventName: "beta_cta_clicked"');
    expect(route).toContain("sessionId: guest.sessionId");
    expect(registry).toMatch(/path:\s*["']\/api\/demo\/events["'][\s\S]{0,180}demo:analytics/);
  });

  it("shows a tracked private-beta CTA only after the guided outcome", async () => {
    const journey = await source("components/demo-guided-case-journey.tsx");

    expect(journey).toContain("https://kinresolve.com/beta");
    expect(journey).toContain("/api/demo/events");
    expect(journey).toContain('eventName: "beta_cta_clicked"');
    expect(journey).toMatch(/outcomeCompleted[\s\S]*Apply for the private beta/);
  });
});

function source(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
}
