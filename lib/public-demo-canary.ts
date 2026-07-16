import { timingSafeEqual } from "node:crypto";

type Environment = Record<string, string | undefined>;

export function isAuthorizedPublicDemoCanary(
  headers: Headers,
  environment: Environment = process.env
): boolean {
  const expected = environment.KINRESOLVE_DEMO_CANARY_SECRET?.trim() ?? "";
  const supplied = headers.get("x-kinresolve-demo-canary")?.trim() ?? "";
  if (expected.length < 32 || supplied.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(supplied, "utf8"), Buffer.from(expected, "utf8"));
}
