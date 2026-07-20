import { describe, expect, it } from "vitest";

import { isPublicArchivePath, publicArchiveEnabled, resolvePublicArchiveId } from "@/lib/public-surface";

const privateHostedEnvironment = {
  KINRESOLVE_DEPLOYMENT_MODE: "hosted",
  KINRESOLVE_DATASET_MODE: "pilot",
  KINRESOLVE_DNA_ENABLED: "false",
  KINRESOLVE_EXTERNAL_AI_ENABLED: "false",
  KINRESOLVE_PUBLIC_ARCHIVE_ENABLED: "false",
  KINRESOLVE_PUBLIC_PUBLISHING_ENABLED: "false",
  KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED: "false",
  KINRESOLVE_PACKAGE_MEDIA_ENABLED: "false",
  KINRESOLVE_PLAIN_GEDCOM_ENABLED: "true"
} as const;

describe("public surface policy", () => {
  it.each(["/", "/people", "/people/ada", "/places", "/stories", "/kinresolve"])(
    "classifies %s as an archive surface",
    (pathname) => expect(isPublicArchivePath(pathname)).toBe(true)
  );

  it.each(["/peopleish", "/story", "/challenge", "/login", "/app"])(
    "does not overmatch %s",
    (pathname) => expect(isPublicArchivePath(pathname)).toBe(false)
  );

  it("retires /kinsleuth from the public surface; the framework redirect answers it", () => {
    expect(isPublicArchivePath("/kinsleuth")).toBe(false);
    expect(isPublicArchivePath("/kinsleuth/anything")).toBe(false);
  });

  it("fails closed when hosted capability configuration is disabled or invalid", () => {
    expect(publicArchiveEnabled(privateHostedEnvironment)).toBe(false);
    expect(publicArchiveEnabled({ KINRESOLVE_DEPLOYMENT_MODE: "hosted" })).toBe(false);
    expect(publicArchiveEnabled({ KINRESOLVE_DEPLOYMENT_MODE: "self-hosted" })).toBe(true);
  });

  it("pins an enabled hosted demo to its canonical public archive", () => {
    expect(resolvePublicArchiveId({
      APP_BASE_URL: "https://demo.kinresolve.com",
      KINRESOLVE_DEPLOYMENT_MODE: "hosted",
      KINRESOLVE_DATASET_MODE: "demo",
      KINRESOLVE_PUBLIC_DEMO_ENABLED: "true",
      KINRESOLVE_PUBLIC_DEMO_ORIGIN: "https://demo.kinresolve.com",
      KINSLEUTH_ARCHIVE_ID: "visitor-controlled-value"
    })).toBe("kinresolve-demo-public");
  });

  it("keeps legacy self-hosted public archives explicit without changing their configured ID", () => {
    expect(resolvePublicArchiveId({
      KINRESOLVE_DEPLOYMENT_MODE: "self-hosted",
      KINSLEUTH_ARCHIVE_ID: "family-public"
    })).toBe("family-public");
    expect(resolvePublicArchiveId({ KINRESOLVE_DEPLOYMENT_MODE: "self-hosted" })).toBe("archive-default");
  });

  it("accepts the canonical KINRESOLVE_ARCHIVE_ID name and fails closed on a mismatched pair", () => {
    expect(resolvePublicArchiveId({
      KINRESOLVE_DEPLOYMENT_MODE: "self-hosted",
      KINRESOLVE_ARCHIVE_ID: "family-public"
    })).toBe("family-public");
    expect(resolvePublicArchiveId({
      KINRESOLVE_DEPLOYMENT_MODE: "self-hosted",
      KINRESOLVE_ARCHIVE_ID: "family-public",
      KINSLEUTH_ARCHIVE_ID: "family-public"
    })).toBe("family-public");
    expect(() => resolvePublicArchiveId({
      KINRESOLVE_DEPLOYMENT_MODE: "self-hosted",
      KINRESOLVE_ARCHIVE_ID: "family-public",
      KINSLEUTH_ARCHIVE_ID: "family-other"
    })).toThrow(/KINRESOLVE_ARCHIVE_ID and KINSLEUTH_ARCHIVE_ID are both set but hold different values/);
  });
});
