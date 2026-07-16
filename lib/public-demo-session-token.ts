import { createHash, randomBytes } from "node:crypto";

export const publicDemoSessionCookieName = "__Host-kinresolve-demo";
export const publicDemoSessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: 86_400
} as const;

const opaqueTokenPattern = /^[A-Za-z0-9_-]{43}$/;

type RandomBytes = (size: number) => Uint8Array;

export function createPublicDemoSessionToken(
  random: RandomBytes = (size) => randomBytes(size)
): string {
  const bytes = random(32);
  if (bytes.byteLength !== 32) {
    throw new Error("The public demo session token source must return exactly 32 bytes.");
  }
  const token = Buffer.from(bytes).toString("base64url");
  validatePublicDemoSessionToken(token);
  return token;
}

export function digestPublicDemoSessionToken(token: string): string {
  validatePublicDemoSessionToken(token);
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function readPublicDemoSessionToken(headers: Headers): string | null {
  const cookieHeader = headers.get("cookie");
  if (!cookieHeader) return null;

  for (const field of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = field.trim().split("=");
    if (rawName !== publicDemoSessionCookieName) continue;
    const value = rawValue.join("=");
    return opaqueTokenPattern.test(value) ? value : null;
  }
  return null;
}

function validatePublicDemoSessionToken(token: string): void {
  if (!opaqueTokenPattern.test(token)) {
    throw new Error("The public demo session token is invalid.");
  }
}
