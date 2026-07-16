import { describe, expect, it, vi } from "vitest";

import { runPublicDemoLoadTest } from "@/scripts/public-demo-load-test.mjs";

const environment = {
  PUBLIC_DEMO_ORIGIN: "https://kinresolve-demo-candidate.vercel.app",
  KINRESOLVE_DEMO_CANARY_SECRET: "c".repeat(43),
  VERCEL_AUTOMATION_BYPASS_SECRET: "v".repeat(43)
};

describe("public demo 25-session load gate", () => {
  it("proves unique simultaneous sessions and always ends all 25", async () => {
    let starts = 0;
    let ends = 0;
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      expect(headers.get("x-kinresolve-demo-canary")).toBe("c".repeat(43));
      expect(headers.get("x-vercel-protection-bypass")).toBe("v".repeat(43));
      expect(headers.has("x-forwarded-for")).toBe(false);
      if (init?.method === "POST" && url.pathname === "/api/demo/sessions") {
        starts += 1;
        return jsonResponse(
          { workspaceUrl: "/app/cases/case-mercer-march-identity?guide=1" },
          201,
          { "set-cookie": `__Host-kinresolve-demo=${token(starts)}; Path=/; Secure; HttpOnly` }
        );
      }
      if (init?.method === "POST" && url.pathname === "/api/demo/session/end") {
        ends += 1;
        return jsonResponse({ ended: true });
      }
      if (url.pathname === "/api/demo/session") {
        return jsonResponse({ session: { status: "active" } });
      }
      if (`${url.pathname}${url.search}` === "/app/cases/case-mercer-march-identity?guide=1") {
        return new Response("<h2>Do these signatures point to the same fictional person?</h2>", {
          headers: { "content-type": "text/html" },
          status: 200
        });
      }
      return new Response(null, { status: 404 });
    });

    await expect(runPublicDemoLoadTest(environment, fetchImplementation)).resolves.toMatchObject({
      sessionCount: 25,
      p95Milliseconds: expect.any(Number)
    });
    expect(starts).toBe(25);
    expect(ends).toBe(25);
  });

  it("ends every successfully created session after a partial start failure", async () => {
    let starts = 0;
    let ends = 0;
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (init?.method === "POST" && url.pathname === "/api/demo/sessions") {
        starts += 1;
        if (starts === 25) return jsonResponse({ error: "capacity" }, 429);
        return jsonResponse({}, 201, {
          "set-cookie": `__Host-kinresolve-demo=${token(starts)}; Path=/; Secure; HttpOnly`
        });
      }
      if (init?.method === "POST" && url.pathname === "/api/demo/session/end") {
        ends += 1;
        return jsonResponse({ ended: true });
      }
      return new Response(null, { status: 404 });
    });

    await expect(runPublicDemoLoadTest(environment, fetchImplementation)).rejects.toThrow(
      /25-session demo capacity gate failed/i
    );
    expect(ends).toBe(24);
  });

  it("refuses canonical or unprotected origins for the disruptive load gate", async () => {
    await expect(runPublicDemoLoadTest({
      ...environment,
      PUBLIC_DEMO_ORIGIN: "https://demo.kinresolve.com"
    }, vi.fn())).rejects.toThrow(/protected generated candidate/i);
    await expect(runPublicDemoLoadTest({
      ...environment,
      VERCEL_AUTOMATION_BYPASS_SECRET: ""
    }, vi.fn())).rejects.toThrow(/credential/i);
  });
});

function token(index: number): string {
  return `${String(index).padStart(2, "0")}${"x".repeat(41)}`;
}

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
    status
  });
}
