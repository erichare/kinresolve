import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createPublicDemoSessionToken,
  digestPublicDemoSessionToken,
  publicDemoSessionCookieName,
  publicDemoSessionCookieOptions
} from "@/lib/public-demo-session-token";

describe("opaque public demo session credentials", () => {
  it("issues 256-bit opaque tokens while retaining only a one-way digest", () => {
    const token = createPublicDemoSessionToken(() => Buffer.alloc(32, 0xab));
    const expectedDigest = createHash("sha256").update(token, "utf8").digest("hex");

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toBe(expectedDigest);
    expect(digestPublicDemoSessionToken(token)).toBe(expectedDigest);
    expect(expectedDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses a host-only secure cookie whose lifetime matches the absolute session expiry", () => {
    expect(publicDemoSessionCookieName).toBe("__Host-kinresolve-demo");
    expect(publicDemoSessionCookieOptions).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 86_400
    });
    expect(publicDemoSessionCookieOptions).not.toHaveProperty("domain");
  });

  it.each(["", "short", "contains whitespace", "a".repeat(44)])(
    "refuses to digest a malformed bearer token %#",
    (token) => {
      expect(() => digestPublicDemoSessionToken(token)).toThrow(/demo session token/i);
    }
  );
});
