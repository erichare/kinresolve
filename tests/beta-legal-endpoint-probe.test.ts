import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { probeBetaLegalEndpoints } from "@/lib/beta-legal-endpoint-probe";

const bodies = {
  "participation-terms": "Approved synthetic participation terms.",
  "privacy-notice": "Approved synthetic privacy notice.",
  "beta-boundary": "Approved synthetic cohort boundary."
} as const;

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const environment = {
  KINRESOLVE_BETA_LEGAL_STATUS: "approved",
  KINRESOLVE_BETA_PARTICIPATION_TERMS_VERSION: "terms-v1",
  KINRESOLVE_BETA_PARTICIPATION_TERMS_SHA256: digest(bodies["participation-terms"]),
  KINRESOLVE_BETA_PARTICIPATION_TERMS_URL: "https://kinresolve.com/legal/terms-v1.txt",
  KINRESOLVE_BETA_PRIVACY_NOTICE_VERSION: "privacy-v1",
  KINRESOLVE_BETA_PRIVACY_NOTICE_SHA256: digest(bodies["privacy-notice"]),
  KINRESOLVE_BETA_PRIVACY_NOTICE_URL: "https://kinresolve.com/legal/privacy-v1.txt",
  KINRESOLVE_BETA_BOUNDARY_VERSION: "boundary-v1",
  KINRESOLVE_BETA_BOUNDARY_SHA256: digest(bodies["beta-boundary"]),
  KINRESOLVE_BETA_BOUNDARY_URL: "https://kinresolve.com/legal/boundary-v1.txt"
};

const legalCsp = "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function runtimeHeaders(name: keyof typeof bodies, overrides: Record<string, string> = {}) {
  const body = bodies[name];
  const sha256 = digest(body);
  return {
    "cache-control": "private, no-store",
    "content-digest": `sha-256=:${Buffer.from(sha256, "hex").toString("base64")}:`,
    "content-disposition": `inline; filename="${name}.txt"`,
    "content-length": String(Buffer.byteLength(body)),
    "content-security-policy": legalCsp,
    "content-type": "text/plain; charset=utf-8",
    "cross-origin-resource-policy": "same-origin",
    etag: `"${sha256}"`,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    ...overrides
  };
}

const sourceFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  const name = url.includes("terms")
    ? "participation-terms"
    : url.includes("privacy")
      ? "privacy-notice"
      : "beta-boundary";
  return new Response(bodies[name], {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" }
  });
});

beforeEach(() => {
  sourceFetch.mockClear();
});

describe("live beta legal endpoint probe", () => {
  it("binds the candidate runtime to all three exact approved document digests", async () => {
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const name = new URL(String(input)).pathname.split("/").at(-1) as keyof typeof bodies;
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).get("x-vercel-protection-bypass")).toBe("bypass-value");
      return new Response(bodies[name], {
        status: 200,
        headers: runtimeHeaders(name)
      });
    });

    await expect(probeBetaLegalEndpoints({
      origin: "https://candidate-123.vercel.app",
      environment,
      bypassSecret: "bypass-value",
      fetch: fetchImplementation,
      sourceFetch
    })).resolves.toEqual([
      { document: "participation-terms", status: "verified" },
      { document: "privacy-notice", status: "verified" },
      { document: "beta-boundary", status: "verified" }
    ]);
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(sourceFetch).toHaveBeenCalledTimes(3);
  });

  it("fails closed on changed runtime bytes, redirects, or unsafe origins", async () => {
    const changed = vi.fn(async () => new Response("changed", { status: 200 }));
    await expect(probeBetaLegalEndpoints({
      origin: "https://candidate-123.vercel.app",
      environment,
      fetch: changed,
      sourceFetch
    })).rejects.toThrow(/legal endpoint/i);

    await expect(probeBetaLegalEndpoints({
      origin: "https://candidate-123.vercel.app/path",
      environment,
      fetch: changed,
      sourceFetch
    })).rejects.toThrow(/origin/i);
  });

  it("fails closed when fixed legal security headers or the source-bound media type drift", async () => {
    const missingCsp = vi.fn(async (input: RequestInfo | URL) => {
      const name = new URL(String(input)).pathname.split("/").at(-1) as keyof typeof bodies;
      const headers = new Headers(runtimeHeaders(name));
      headers.delete("content-security-policy");
      return new Response(bodies[name], { status: 200, headers });
    });
    await expect(probeBetaLegalEndpoints({
      origin: "https://candidate-123.vercel.app",
      environment,
      fetch: missingCsp,
      sourceFetch
    })).rejects.toThrow(/legal endpoint/i);

    const missingNosniff = vi.fn(async (input: RequestInfo | URL) => {
      const name = new URL(String(input)).pathname.split("/").at(-1) as keyof typeof bodies;
      const headers = new Headers(runtimeHeaders(name));
      headers.delete("x-content-type-options");
      return new Response(bodies[name], { status: 200, headers });
    });
    await expect(probeBetaLegalEndpoints({
      origin: "https://candidate-123.vercel.app",
      environment,
      fetch: missingNosniff,
      sourceFetch
    })).rejects.toThrow(/legal endpoint/i);

    const retypedHtml = vi.fn(async (input: RequestInfo | URL) => {
      const name = new URL(String(input)).pathname.split("/").at(-1) as keyof typeof bodies;
      return new Response(bodies[name], {
        status: 200,
        headers: runtimeHeaders(name, {
          "content-type": "text/html; charset=utf-8",
          "content-disposition": `inline; filename="${name}.html"`
        })
      });
    });
    await expect(probeBetaLegalEndpoints({
      origin: "https://candidate-123.vercel.app",
      environment,
      fetch: retypedHtml,
      sourceFetch
    })).rejects.toThrow(/legal endpoint/i);
  });
});
