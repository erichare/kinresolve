import { betaApplicationMode } from "@/lib/beta-application-mode";

// The Turnstile site key is a public widget identifier baked into the static
// export at build time. It protects the native beta intake, so an
// application-mode build without it must fail instead of silently shipping an
// unprotected form. Mailto builds never render the widget and need no key.
export function parseMarketingTurnstileSiteKey(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^[0-9A-Za-z_-]{1,128}$/.test(value)) {
    throw new Error("KINRESOLVE_MARKETING_TURNSTILE_SITE_KEY must be a plain widget site key.");
  }
  return value;
}

export const marketingTurnstileSiteKey = parseMarketingTurnstileSiteKey(
  process.env.KINRESOLVE_MARKETING_TURNSTILE_SITE_KEY
);

if (betaApplicationMode === "application" && marketingTurnstileSiteKey === undefined) {
  throw new Error(
    "KINRESOLVE_MARKETING_TURNSTILE_SITE_KEY must be set when the beta intake mode is application."
  );
}
