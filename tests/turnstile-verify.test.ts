import { describe, expect, it, vi } from "vitest";

import {
  turnstileSiteverifyUrl,
  turnstileTokenMaximumLength,
  turnstileVerifyTimeoutMilliseconds,
  verifyTurnstileToken,
  wellFormedTurnstileToken
} from "@/lib/turnstile-verify";

const input = {
  expectedAction: "beta-application",
  expectedHostname: "kinresolve.com",
  secretKey: "s".repeat(35),
  token: "well-formed-token"
} as const;

function siteverifyResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}

describe("Turnstile server-side verification", () => {
  it("pins the 2-second siteverify budget and canonical endpoint", () => {
    expect(turnstileVerifyTimeoutMilliseconds).toBe(2_000);
    expect(turnstileSiteverifyUrl).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    );
  });

  it("verifies success only when the action and hostname match our widget", async () => {
    const fetchImplementation = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe(turnstileSiteverifyUrl);
      const body = init?.body as URLSearchParams;
      expect(body.get("response")).toBe(input.token);
      expect(body.get("secret")).toBe(input.secretKey);
      return siteverifyResponse({
        action: "beta-application",
        hostname: "kinresolve.com",
        success: true
      });
    });
    await expect(verifyTurnstileToken(input, { fetchImplementation }))
      .resolves.toEqual({ outcome: "verified" });
  });

  it.each([
    ["definitive failure", { success: false, "error-codes": ["invalid-input-response"] }],
    ["foreign action", { action: "demo-session", hostname: "kinresolve.com", success: true }],
    ["foreign hostname", { action: "beta-application", hostname: "evil.example", success: true }]
  ])("rejects a %s verdict", async (_label, body) => {
    const fetchImplementation = vi.fn(async () => siteverifyResponse(body));
    await expect(verifyTurnstileToken(input, { fetchImplementation }))
      .resolves.toEqual({ outcome: "rejected" });
  });

  it("rejects malformed tokens locally without contacting siteverify", async () => {
    const fetchImplementation = vi.fn();
    for (const token of ["", "a".repeat(turnstileTokenMaximumLength + 1), "bad token\n"]) {
      expect(wellFormedTurnstileToken(token)).toBe(false);
      await expect(verifyTurnstileToken({ ...input, token }, { fetchImplementation }))
        .resolves.toEqual({ outcome: "rejected" });
    }
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    ["network failure", async () => { throw new Error("ECONNRESET"); }],
    ["non-2xx status", async () => siteverifyResponse({}, 503)],
    ["malformed body", async () => new Response("not json", { status: 200 })],
    ["non-object body", async () => siteverifyResponse(null)]
  ])("classifies a %s as unavailable so callers fall back to the strict lane", async (_label, impl) => {
    const fetchImplementation = vi.fn(impl as () => Promise<Response>);
    const verdict = await verifyTurnstileToken(input, { fetchImplementation });
    expect(verdict.outcome).toBe("unavailable");
  });

  it("classifies a missing secret key as unavailable without calling siteverify", async () => {
    const fetchImplementation = vi.fn();
    const verdict = await verifyTurnstileToken({ ...input, secretKey: " " }, { fetchImplementation });
    expect(verdict.outcome).toBe("unavailable");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("aborts a hung siteverify call at the configured timeout", async () => {
    const fetchImplementation = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason instanceof Error ? init.signal.reason : new Error("aborted"));
        });
      })
    );
    const verdict = await verifyTurnstileToken(input, {
      fetchImplementation,
      timeoutMilliseconds: 25
    });
    expect(verdict.outcome).toBe("unavailable");
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
});
