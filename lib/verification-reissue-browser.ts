export const verificationReissueGenericMessage =
  "If an eligible account matches that email, a verification message will arrive shortly.";

export type VerificationReissueFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export async function requestBetaVerificationReissue(
  email: string,
  fetchImplementation: VerificationReissueFetch = globalThis.fetch
): Promise<string> {
  try {
    await fetchImplementation("/api/beta/email-verification/reissue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      credentials: "omit",
      body: JSON.stringify({ email })
    });
  } catch {
    // Network and server outcomes intentionally project to the same public
    // completion state so this browser surface cannot enumerate accounts.
  }
  return verificationReissueGenericMessage;
}
