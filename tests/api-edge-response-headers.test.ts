import { describe, expect, it } from "vitest";

import { validateApiEdgeResponseHeaders } from "@/lib/api-edge-response-headers";

function headers(...lines: string[]): string {
  return [`HTTP/2 401`, ...lines, "", ""].join("\r\n");
}

describe("API edge response header policy", () => {
  it("accepts an exact private, no-store JSON response", () => {
    expect(() => validateApiEdgeResponseHeaders(headers(
      "content-type: application/json; charset=utf-8",
      "cache-control: private, no-store, max-age=0"
    ), "ordinary")).not.toThrow();
  });

  it.each([
    ["media-type prefix", "content-type: application/json-bogus", "cache-control: private, no-store"],
    ["private substring", "content-type: application/json", "cache-control: not-private, no-store"],
    ["no-store substring", "content-type: application/json", "cache-control: private, x-no-store=1"],
    ["missing private", "content-type: application/json", "cache-control: no-store"],
    ["missing no-store", "content-type: application/json", "cache-control: private"],
    ["positive freshness", "content-type: application/json", "cache-control: private, no-store, max-age=60"],
    ["shared freshness", "content-type: application/json", "cache-control: private, no-store, s-maxage=1"],
    ["duplicated directive", "content-type: application/json", "cache-control: private, no-store, PRIVATE"]
  ])("rejects %s", (_label, contentType, cacheControl) => {
    expect(() => validateApiEdgeResponseHeaders(headers(contentType, cacheControl), "ordinary"))
      .toThrow();
  });

  it("accepts a 429 with no Cache-Control and exact safe directives when present", () => {
    expect(() => validateApiEdgeResponseHeaders(headers("content-type: text/plain"), "rate-limited"))
      .not.toThrow();
    expect(() => validateApiEdgeResponseHeaders(headers(
      "content-type: text/plain",
      "cache-control: no-cache, max-age=0"
    ), "rate-limited")).not.toThrow();
  });

  it("rejects unsafe or substring-only 429 cache controls", () => {
    for (const value of ["max-age=1", "public", "x-no-store=1", "s-maxage=0"]) {
      expect(() => validateApiEdgeResponseHeaders(headers(
        "content-type: text/plain",
        `cache-control: ${value}`
      ), "rate-limited")).toThrow();
    }
  });

  it("requires exact HTML for the direct deployment-protection response", () => {
    expect(() => validateApiEdgeResponseHeaders(headers("content-type: text/html; charset=utf-8"), "direct-protection"))
      .not.toThrow();
    expect(() => validateApiEdgeResponseHeaders(headers("content-type: text/html-bogus"), "direct-protection"))
      .toThrow();
  });

  it("allows provider authentication mechanics but rejects unsafe direct-response caching", () => {
    expect(() => validateApiEdgeResponseHeaders(headers(
      "content-type: text/html",
      "location: https://vercel.com/login",
      "set-cookie: _vercel_sso_nonce=opaque; Secure; HttpOnly"
    ), "direct-protection")).not.toThrow();
    for (const cacheControl of ["public", "max-age=1", "s-maxage=0"]) {
      expect(() => validateApiEdgeResponseHeaders(headers(
        "content-type: text/html",
        `cache-control: ${cacheControl}`
      ), "direct-protection")).toThrow();
    }
  });

  it("rejects stateful canonical response headers", () => {
    for (const line of ["set-cookie: bypass=value", "location: https://example.test/"]) {
      expect(() => validateApiEdgeResponseHeaders(headers(
        "content-type: application/json",
        "cache-control: private, no-store",
        line
      ), "canonical")).toThrow();
    }
  });

  it("uses only the last response block and rejects folded headers", () => {
    const final = headers("content-type: application/json", "cache-control: private, no-store");
    expect(() => validateApiEdgeResponseHeaders(
      `HTTP/1.1 100 Continue\r\ncache-control: public\r\n\r\n${final}`,
      "ordinary"
    )).not.toThrow();
    expect(() => validateApiEdgeResponseHeaders(headers(
      "content-type: application/json",
      "cache-control: private,",
      " no-store"
    ), "ordinary")).toThrow(/folded/i);
  });
});
