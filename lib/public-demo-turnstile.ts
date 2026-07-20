import { captureOperationalError } from "./observability";
import {
  verifyTurnstileToken,
  type TurnstileVerdict,
  type TurnstileVerifyInput,
  type TurnstileVerifyOptions
} from "./turnstile-verify";

// Cloudflare Turnstile on public demo session starts. The mode ladder is
// off -> shadow -> required: shadow verifies and logs without changing any
// admission decision (the pre-launch soak), and required rejects unverified
// human starts with the stateless family/challenge fallbacks. Authorized
// canaries and load tests always bypass the challenge so monitoring and the
// launch gates stay independent of Cloudflare availability.

type Environment = Record<string, string | undefined>;

export type PublicDemoTurnstileMode = "off" | "shadow" | "required";

export const publicDemoTurnstileAction = "demo-session";
export const publicDemoTurnstileHostname = "demo.kinresolve.com";

export function parsePublicDemoTurnstileMode(value: string | undefined): PublicDemoTurnstileMode {
  if (value === undefined || value === "off") return "off";
  if (value === "shadow" || value === "required") return value;
  throw new Error("KINRESOLVE_DEMO_TURNSTILE_MODE must be exactly off, shadow, or required.");
}

export type PublicDemoTurnstileConfiguration =
  | Readonly<{ mode: "off" }>
  | Readonly<{ mode: "shadow" | "required"; secretKey: string; siteKey: string }>;

export function resolvePublicDemoTurnstileConfiguration(
  environment: Environment = process.env
): PublicDemoTurnstileConfiguration {
  const mode = parsePublicDemoTurnstileMode(environment.KINRESOLVE_DEMO_TURNSTILE_MODE);
  if (mode === "off") return { mode };
  const siteKey = environment.NEXT_PUBLIC_KINRESOLVE_DEMO_TURNSTILE_SITE_KEY?.trim() ?? "";
  if (!/^[0-9A-Za-z_-]{1,128}$/.test(siteKey)) {
    throw new Error(
      "NEXT_PUBLIC_KINRESOLVE_DEMO_TURNSTILE_SITE_KEY must be a plain widget site key when the demo Turnstile mode is enabled."
    );
  }
  const secretKey = environment.KINRESOLVE_TURNSTILE_SECRET_KEY?.trim() ?? "";
  if (secretKey === "") {
    throw new Error(
      "KINRESOLVE_TURNSTILE_SECRET_KEY is required when the demo Turnstile mode is enabled."
    );
  }
  return { mode, secretKey, siteKey };
}

export type PublicDemoTurnstileAdmission = Readonly<{
  outcome: "admitted" | "rejected";
}>;

export type PublicDemoTurnstileDependencies = Readonly<{
  captureError?: typeof captureOperationalError;
  verify?: (
    input: TurnstileVerifyInput,
    options?: TurnstileVerifyOptions
  ) => Promise<TurnstileVerdict>;
}>;

export async function admitPublicDemoTurnstile(
  input: Readonly<{
    configuration: PublicDemoTurnstileConfiguration;
    isCanary: boolean;
    token: string | undefined;
  }>,
  dependencies: PublicDemoTurnstileDependencies = {}
): Promise<PublicDemoTurnstileAdmission> {
  const { configuration } = input;
  if (configuration.mode === "off" || input.isCanary) return { outcome: "admitted" };

  if (input.token === undefined || input.token === "") {
    if (configuration.mode === "required") {
      return { outcome: "rejected" };
    }
    // Shadow soak visibility: count token-free human starts without blocking.
    await capture(dependencies, { code: "AUTHORIZATION_ERROR" });
    return { outcome: "admitted" };
  }

  const verify = dependencies.verify ?? verifyTurnstileToken;
  const verdict = await verify({
    expectedAction: publicDemoTurnstileAction,
    expectedHostname: publicDemoTurnstileHostname,
    secretKey: configuration.secretKey,
    token: input.token
  });
  if (verdict.outcome === "verified") return { outcome: "admitted" };
  if (verdict.outcome === "rejected") {
    await capture(dependencies, { code: "AUTHORIZATION_ERROR" });
    return { outcome: configuration.mode === "required" ? "rejected" : "admitted" };
  }
  // A siteverify outage never blocks visitors — the capacity cap and the
  // per-network rate limits still hold — but it is captured operationally so
  // a broken challenge cannot soak silently.
  await capture(dependencies, verdict.error);
  return { outcome: "admitted" };
}

async function capture(
  dependencies: PublicDemoTurnstileDependencies,
  error: unknown
): Promise<void> {
  const captureError = dependencies.captureError ?? captureOperationalError;
  try {
    await captureError({
      event: "api_error",
      route: "/api/demo/sessions",
      severity: "warning",
      statusClass: "2xx"
    }, error);
  } catch {
    // Best-effort telemetry: visitor admission never depends on it.
  }
}
