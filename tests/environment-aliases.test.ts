import { describe, expect, it } from "vitest";

import {
  allowSignupsEnvironmentAlias,
  archiveIdEnvironmentAlias,
  describeEnvironmentAliasPair,
  environmentAliasPairs,
  readAliasedEnvironmentSetting,
  readAllowSignupsSetting,
  readArchiveIdSetting
} from "@/lib/environment-aliases";

describe("environment rename compatibility aliases", () => {
  it("pins the two aliased pairs and their canonical/legacy names", () => {
    expect(environmentAliasPairs).toEqual([
      { canonicalName: "KINRESOLVE_ARCHIVE_ID", legacyName: "KINSLEUTH_ARCHIVE_ID" },
      { canonicalName: "KINRESOLVE_ALLOW_SIGNUPS", legacyName: "KINSLEUTH_ALLOW_SIGNUPS" }
    ]);
    expect(describeEnvironmentAliasPair(archiveIdEnvironmentAlias))
      .toBe("KINRESOLVE_ARCHIVE_ID (or legacy KINSLEUTH_ARCHIVE_ID)");
    expect(describeEnvironmentAliasPair(allowSignupsEnvironmentAlias))
      .toBe("KINRESOLVE_ALLOW_SIGNUPS (or legacy KINSLEUTH_ALLOW_SIGNUPS)");
  });

  it.each(environmentAliasPairs)(
    "reads $canonicalName from either name and prefers the canonical value",
    (pair) => {
      expect(readAliasedEnvironmentSetting(pair, {})).toBeUndefined();
      expect(readAliasedEnvironmentSetting(pair, { [pair.canonicalName]: "value-a" })).toBe("value-a");
      expect(readAliasedEnvironmentSetting(pair, { [pair.legacyName]: "value-b" })).toBe("value-b");
      expect(readAliasedEnvironmentSetting(pair, {
        [pair.canonicalName]: "same-value",
        [pair.legacyName]: "same-value"
      })).toBe("same-value");
    }
  );

  it.each(environmentAliasPairs)(
    "fails closed when $canonicalName and $legacyName are both set but differ",
    (pair) => {
      expect(() => readAliasedEnvironmentSetting(pair, {
        [pair.canonicalName]: "value-a",
        [pair.legacyName]: "value-b"
      })).toThrow(new RegExp(
        `${pair.canonicalName} and ${pair.legacyName} are both set but hold different values`
      ));
    }
  );

  it("treats an empty string as a set value so a blank override cannot silently win", () => {
    expect(() => readAliasedEnvironmentSetting(archiveIdEnvironmentAlias, {
      KINRESOLVE_ARCHIVE_ID: "",
      KINSLEUTH_ARCHIVE_ID: "archive-default"
    })).toThrow(/both set but hold different values/);
  });

  it("exposes dedicated readers for the archive id and signup settings", () => {
    expect(readArchiveIdSetting({ KINSLEUTH_ARCHIVE_ID: "archive-default" })).toBe("archive-default");
    expect(readArchiveIdSetting({ KINRESOLVE_ARCHIVE_ID: "archive-new" })).toBe("archive-new");
    expect(readAllowSignupsSetting({ KINSLEUTH_ALLOW_SIGNUPS: "false" })).toBe("false");
    expect(readAllowSignupsSetting({ KINRESOLVE_ALLOW_SIGNUPS: "true" })).toBe("true");
    expect(() => readAllowSignupsSetting({
      KINRESOLVE_ALLOW_SIGNUPS: "true",
      KINSLEUTH_ALLOW_SIGNUPS: "false"
    })).toThrow(/KINRESOLVE_ALLOW_SIGNUPS and KINSLEUTH_ALLOW_SIGNUPS/);
  });
});
