import { describe, expect, it } from "vitest";

import { clientAddressRateLimitSubject } from "@/lib/auth-rate-limit-subject";

function request(headers: HeadersInit): Pick<Request, "headers"> {
  return { headers: new Headers(headers) };
}

describe("auth rate-limit client subject", () => {
  it("uses only Vercel's edge-owned client address header on Vercel", () => {
    expect(clientAddressRateLimitSubject(request({
      "x-forwarded-for": "203.0.113.99",
      "x-real-ip": "203.0.113.98",
      "x-vercel-forwarded-for": "2001:db8::1"
    }), { VERCEL: "1" })).toBe("client-address:2001:db8::1");
  });

  it("does not trust caller-supplied forwarding headers outside Vercel", () => {
    expect(clientAddressRateLimitSubject(request({
      "x-forwarded-for": "203.0.113.99",
      "x-vercel-forwarded-for": "203.0.113.1"
    }), {})).toBe("client-address:unavailable");
  });

  it.each(["", "unknown", "203.0.113.1, 10.0.0.1", "203.0.113.1:443"])(
    "fails closed for an invalid edge address %j",
    (value) => {
      expect(clientAddressRateLimitSubject(request({
        "x-vercel-forwarded-for": value
      }), { VERCEL: "1" })).toBe("client-address:unavailable");
    }
  );
});
