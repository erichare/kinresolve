import { describe, expect, it } from "vitest";

import { assertVercelProtectionResponse } from "@/lib/vercel-protection-response";

const expectedRequestUrl = "https://kinresolve-staging-example.vercel.app/";
const nonce = "a".repeat(64);

function headers(location: string): string {
  return `HTTP/2 302\r\nlocation: ${location}\r\nserver: Vercel\r\n\r\n`;
}

function protectedRedirect(requestUrl = expectedRequestUrl): string {
  const location = new URL("https://vercel.com/sso-api");
  location.searchParams.set("url", requestUrl);
  location.searchParams.set("nonce", nonce);
  return location.href;
}

describe("Vercel deployment protection response", () => {
  it.each(["401", "403"])("accepts a direct %s denial", (status) => {
    expect(() => assertVercelProtectionResponse({
      status,
      rawHeaders: "",
      expectedRequestUrl
    })).not.toThrow();
  });

  it("accepts the exact Vercel SSO protection redirect", () => {
    expect(() => assertVercelProtectionResponse({
      status: "302",
      rawHeaders: headers(protectedRedirect()),
      expectedRequestUrl
    })).not.toThrow();
  });

  it.each([
    ["an arbitrary redirect", "https://example.com/login"],
    ["a redirect for another deployment", protectedRedirect("https://other.vercel.app/")],
    ["a redirect with an invalid nonce", "https://vercel.com/sso-api?url=https%3A%2F%2Fkinresolve-staging-example.vercel.app%2F&nonce=short"],
    ["a redirect with extra parameters", `${protectedRedirect()}&next=https%3A%2F%2Fexample.com`]
  ])("rejects %s", (_label, location) => {
    expect(() => assertVercelProtectionResponse({
      status: "302",
      rawHeaders: headers(location),
      expectedRequestUrl
    })).toThrow();
  });

  it("rejects repeated Location headers", () => {
    const location = protectedRedirect();
    expect(() => assertVercelProtectionResponse({
      status: "302",
      rawHeaders: `${headers(location)}location: ${location}\r\n`,
      expectedRequestUrl
    })).toThrow();
  });

  it("rejects an ordinary success response", () => {
    expect(() => assertVercelProtectionResponse({
      status: "200",
      rawHeaders: "HTTP/2 200\r\n\r\n",
      expectedRequestUrl
    })).toThrow();
  });
});
