const canaryEmailTokenPlaceholder = "{token}";
const emailAddressPattern =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+@[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;
const positiveIntegerPattern = /^[1-9][0-9]{0,19}$/;

export type BetaApplicationCanaryPhase = "production" | "staging";

export function resolveBetaApplicationCanaryEmail(input: Readonly<{
  pattern: string;
  phase: string;
  runAttempt: string;
  runId: string;
}>): string {
  const { pattern, phase, runAttempt, runId } = input;
  if (
    (phase !== "production" && phase !== "staging")
    || !positiveIntegerPattern.test(runId)
    || !positiveIntegerPattern.test(runAttempt)
    || pattern !== pattern.trim()
    || pattern !== pattern.toLowerCase()
    || pattern.split(canaryEmailTokenPlaceholder).length !== 2
  ) {
    throw new Error("Beta intake release canary identity configuration is invalid.");
  }

  const token = `${phase}-run-${runId}-attempt-${runAttempt}`;
  const email = pattern.replace(canaryEmailTokenPlaceholder, token);
  const localPart = email.slice(0, email.indexOf("@"));
  if (
    email.length > 254
    || !emailAddressPattern.test(email)
    || email.includes("..")
    || localPart.startsWith(".")
    || localPart.endsWith(".")
  ) {
    throw new Error("Beta intake release canary identity configuration is invalid.");
  }
  return email;
}
