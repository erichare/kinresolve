/**
 * A browser-held capability remains usable when the server is temporarily
 * paused, rate-limited, or unavailable. Callers handle transport exceptions as
 * retryable separately because they do not carry an HTTP status.
 */
export function isRetryableBrowserActionStatus(status: number): boolean {
  return status === 423
    || status === 429
    || (status >= 500 && status <= 599);
}
