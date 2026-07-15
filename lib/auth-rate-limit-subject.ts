import { isIP } from "node:net";

type Environment = Record<string, string | undefined>;

const unavailableSubject = "client-address:unavailable";

/**
 * Returns a short-lived input for the HMAC-backed rate limiter. Callers must
 * never persist or log this value. Vercel overwrites its forwarding headers at
 * the edge; outside Vercel we deliberately refuse caller-supplied proxy
 * headers instead of allowing bucket spoofing.
 */
export function clientAddressRateLimitSubject(
  request: Pick<Request, "headers">,
  environment: Environment = process.env
): string {
  if (environment.VERCEL !== "1") return unavailableSubject;

  const candidate = request.headers.get("x-vercel-forwarded-for")?.trim() ?? "";
  if (!candidate || candidate.includes(",") || isIP(candidate) === 0) {
    return unavailableSubject;
  }
  return `client-address:${candidate.toLowerCase()}`;
}
