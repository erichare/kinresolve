// Server-side Cloudflare Turnstile verification for the beta intake.
//
// The beta form keeps its no-JS cross-origin form-POST contract: the token is
// optional, so verification failure classes matter. A definitive verified
// token unlocks the standard rate lanes; everything else (absent token,
// definitive rejection, or a siteverify outage) falls back to the strict
// lanes in lib/beta-application-http.ts instead of rejecting the applicant.

export const turnstileSiteverifyUrl =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const turnstileVerifyTimeoutMilliseconds = 2_000;
export const turnstileTokenMaximumLength = 2_048;

export type TurnstileVerdict =
  | Readonly<{ outcome: "verified" }>
  | Readonly<{ outcome: "rejected" }>
  | Readonly<{ outcome: "unavailable"; error: unknown }>;

export type TurnstileVerifyInput = Readonly<{
  expectedAction: string;
  expectedHostname: string;
  secretKey: string;
  token: string;
}>;

export type TurnstileVerifyOptions = Readonly<{
  fetchImplementation?: typeof fetch;
  timeoutMilliseconds?: number;
}>;

export function wellFormedTurnstileToken(token: string): boolean {
  return token.length > 0
    && token.length <= turnstileTokenMaximumLength
    && /^[\x21-\x7e]+$/.test(token);
}

export async function verifyTurnstileToken(
  input: TurnstileVerifyInput,
  options: TurnstileVerifyOptions = {}
): Promise<TurnstileVerdict> {
  if (!wellFormedTurnstileToken(input.token)) return { outcome: "rejected" };
  if (input.secretKey.trim() === "") {
    return { outcome: "unavailable", error: new Error("Turnstile secret key is not configured.") };
  }

  const fetchImplementation = options.fetchImplementation ?? fetch;
  const timeoutMilliseconds = options.timeoutMilliseconds ?? turnstileVerifyTimeoutMilliseconds;
  const body = new URLSearchParams({
    response: input.token,
    secret: input.secretKey
  });

  let payload: unknown;
  try {
    const response = await fetchImplementation(turnstileSiteverifyUrl, {
      body,
      headers: { accept: "application/json" },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMilliseconds)
    });
    if (!response.ok) {
      return {
        outcome: "unavailable",
        error: new Error(`Turnstile siteverify returned status ${response.status}.`)
      };
    }
    payload = await response.json();
  } catch (error: unknown) {
    return { outcome: "unavailable", error };
  }

  if (typeof payload !== "object" || payload === null) {
    return { outcome: "unavailable", error: new Error("Turnstile siteverify body is malformed.") };
  }
  const record = payload as { action?: unknown; hostname?: unknown; success?: unknown };
  if (record.success !== true) return { outcome: "rejected" };
  // A successful verification must additionally prove it was produced by our
  // widget on our page: the action and hostname are attacker-selectable when
  // a token is minted elsewhere and replayed here.
  if (record.action !== input.expectedAction) return { outcome: "rejected" };
  if (record.hostname !== input.expectedHostname) return { outcome: "rejected" };
  return { outcome: "verified" };
}
