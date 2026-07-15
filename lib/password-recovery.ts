export const passwordResetRequestMessage =
  "If an eligible account matches that email, a password-reset message will arrive shortly. Check your inbox and spam folder.";

export const passwordResetFailureMessage =
  "We could not reset the password from this link. Request a new password-reset message and try again.";

const passwordResetFragmentPattern = /^#token=([A-Za-z0-9_-]{16,512})$/;

/**
 * Reads the recovery capability only from an exact URL fragment. Fragments are
 * never sent to the server or included in referrer headers. The caller must
 * remove the fragment from browser history immediately after calling this.
 */
export function passwordResetTokenFromFragment(fragment: string): string | null {
  return passwordResetFragmentPattern.exec(fragment)?.[1] ?? null;
}
