import { describe, expect, it } from "vitest";

import {
  HostedCapabilityError,
  hostedGedcomFileLimitBytes,
  hostedGedcomPersonLimit,
  requireHostedCapability,
  resolveHostedCapabilities,
  validateHostedGedcomFile,
  validateHostedGedcomPeople
} from "@/lib/hosted-capabilities";

const privateBetaEnvironment = {
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

describe("hosted private-beta capabilities", () => {
  it("resolves the explicit cohort-one capability manifest", () => {
    expect(resolveHostedCapabilities(privateBetaEnvironment)).toEqual({
      deploymentMode: "hosted",
      datasetMode: "pilot",
      dna: false,
      externalAi: false,
      publicArchive: false,
      publicPublishing: false,
      evidenceBinaryUploads: false,
      packageMedia: false,
      plainGedcom: true,
      gedcomFileLimitBytes: hostedGedcomFileLimitBytes,
      gedcomPersonLimit: hostedGedcomPersonLimit
    });
  });

  it.each([
    "KINRESOLVE_DNA_ENABLED",
    "KINRESOLVE_EXTERNAL_AI_ENABLED",
    "KINRESOLVE_PUBLIC_ARCHIVE_ENABLED",
    "KINRESOLVE_PUBLIC_PUBLISHING_ENABLED",
    "KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED",
    "KINRESOLVE_PACKAGE_MEDIA_ENABLED",
    "KINRESOLVE_PLAIN_GEDCOM_ENABLED"
  ] as const)("fails closed when hosted %s is absent", (name) => {
    const environment: Record<string, string | undefined> = { ...privateBetaEnvironment };
    delete environment[name];

    expect(() => resolveHostedCapabilities(environment)).toThrow(new RegExp(`${name}.*required.*hosted`, "i"));
  });

  it("accepts only explicit true or false capability values", () => {
    expect(() => resolveHostedCapabilities({
      ...privateBetaEnvironment,
      KINRESOLVE_DNA_ENABLED: "yes"
    })).toThrow(/KINRESOLVE_DNA_ENABLED.*true or false/i);
  });

  it("preserves self-hosted capabilities unless an operator disables them", () => {
    expect(resolveHostedCapabilities({ KINRESOLVE_DEPLOYMENT_MODE: "self-hosted" })).toMatchObject({
      deploymentMode: "self-hosted",
      datasetMode: "demo",
      dna: true,
      externalAi: true,
      publicArchive: true,
      publicPublishing: true,
      evidenceBinaryUploads: true,
      packageMedia: true,
      plainGedcom: true
    });
    expect(resolveHostedCapabilities({
      KINRESOLVE_DEPLOYMENT_MODE: "self-hosted",
      KINRESOLVE_DNA_ENABLED: "false"
    }).dna).toBe(false);
  });

  it("rejects disabled capabilities with a safe not-found error", () => {
    expect(() => requireHostedCapability("dna", privateBetaEnvironment)).toThrow(HostedCapabilityError);
    try {
      requireHostedCapability("dna", privateBetaEnvironment);
      throw new Error("Expected DNA to be disabled");
    } catch (error) {
      expect(error).toMatchObject({ code: "CAPABILITY_DISABLED", status: 404 });
      expect(String(error)).not.toMatch(/KINRESOLVE_DNA_ENABLED/);
    }
  });

  it.each([
    hostedGedcomFileLimitBytes - 1,
    hostedGedcomFileLimitBytes
  ])("accepts a plain GEDCOM at %i bytes", (size) => {
    expect(() => validateHostedGedcomFile(
      { fileName: "family.ged", contentType: "text/plain", size },
      privateBetaEnvironment
    )).not.toThrow();
  });

  it("rejects non-GEDCOM packages and bytes above the hosted limit", () => {
    expect(() => validateHostedGedcomFile(
      { fileName: "family.zip", contentType: "application/zip", size: 1024 },
      privateBetaEnvironment
    )).toThrow(/plain GEDCOM/i);
    try {
      validateHostedGedcomFile(
        { fileName: "family.ged", contentType: "text/plain", size: hostedGedcomFileLimitBytes + 1 },
        privateBetaEnvironment
      );
      throw new Error("Expected the hosted byte limit to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "GEDCOM_FILE_TOO_LARGE", status: 413 });
    }
  });

  it.each([
    hostedGedcomPersonLimit - 1,
    hostedGedcomPersonLimit
  ])("accepts %i parsed people", (people) => {
    expect(() => validateHostedGedcomPeople(people, privateBetaEnvironment)).not.toThrow();
  });

  it("rejects parsed people above the hosted limit", () => {
    try {
      validateHostedGedcomPeople(hostedGedcomPersonLimit + 1, privateBetaEnvironment);
      throw new Error("Expected the hosted person limit to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "GEDCOM_PERSON_LIMIT_EXCEEDED", status: 413 });
    }
  });
});
