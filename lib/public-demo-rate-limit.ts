import { createHmac } from "node:crypto";

type Environment = Record<string, string | undefined>;

export function derivePublicDemoNetworkDigest(
  subject: string,
  environment: Environment = process.env
): string {
  const secret = environment.KINRESOLVE_DEMO_PRIVACY_HMAC_SECRET?.trim() ?? "";
  if (secret.length < 32) {
    throw new Error("KINRESOLVE_DEMO_PRIVACY_HMAC_SECRET must contain at least 32 characters.");
  }
  for (const name of [
    "AUTH_SECRET",
    "KINRESOLVE_BETA_PRIVACY_HMAC_SECRET",
    "KINRESOLVE_BETA_APPLICATION_HMAC_SECRET",
    "KINRESOLVE_API_CURSOR_SECRET",
    "CRON_SECRET"
  ]) {
    if (environment[name]?.trim() === secret) {
      throw new Error("The public demo privacy HMAC secret must be dedicated.");
    }
  }
  return createHmac("sha256", secret)
    .update("kinresolve-public-demo-network-v1\0", "utf8")
    .update(subject, "utf8")
    .digest("hex");
}
