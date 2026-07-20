// KinSleuth -> Kin Resolve environment-variable rename compatibility window.
//
// Readers accept the canonical KINRESOLVE_* name and fall back to the legacy
// KINSLEUTH_* name. When both names are set they must be byte-identical;
// anything else fails closed with a precise error so a half-renamed cell can
// never release or run with an ambiguous identity. The legacy names are
// deleted (strict flip) post-launch; KINSLEUTH_APP_PASSWORD is a redaction
// list entry only and is intentionally not aliased.

type Environment = Readonly<Record<string, string | undefined>>;

export const archiveIdEnvironmentAlias = {
  canonicalName: "KINRESOLVE_ARCHIVE_ID",
  legacyName: "KINSLEUTH_ARCHIVE_ID"
} as const;

export const allowSignupsEnvironmentAlias = {
  canonicalName: "KINRESOLVE_ALLOW_SIGNUPS",
  legacyName: "KINSLEUTH_ALLOW_SIGNUPS"
} as const;

export const environmentAliasPairs = [
  archiveIdEnvironmentAlias,
  allowSignupsEnvironmentAlias
] as const;

export type EnvironmentAliasPair = (typeof environmentAliasPairs)[number];

export function describeEnvironmentAliasPair(pair: EnvironmentAliasPair): string {
  return `${pair.canonicalName} (or legacy ${pair.legacyName})`;
}

export function readAliasedEnvironmentSetting(
  pair: EnvironmentAliasPair,
  environment: Environment = process.env
): string | undefined {
  const canonicalValue = environment[pair.canonicalName];
  const legacyValue = environment[pair.legacyName];
  if (canonicalValue !== undefined && legacyValue !== undefined && canonicalValue !== legacyValue) {
    throw new Error(
      `${pair.canonicalName} and ${pair.legacyName} are both set but hold different values; `
      + `set both to the same value for the rename compatibility window or unset ${pair.legacyName}.`
    );
  }
  return canonicalValue ?? legacyValue;
}

export function readArchiveIdSetting(environment: Environment = process.env): string | undefined {
  return readAliasedEnvironmentSetting(archiveIdEnvironmentAlias, environment);
}

export function readAllowSignupsSetting(environment: Environment = process.env): string | undefined {
  return readAliasedEnvironmentSetting(allowSignupsEnvironmentAlias, environment);
}
