import { describe, expect, it } from "vitest";

import {
  BetaApplicationError,
  betaApplicationRuntimeConfiguration,
  betaApplicationsEnabled,
  deriveBetaApplicationDigest,
  normalizeBetaApplication
} from "@/lib/beta-applications";

const secret = "application-hmac-secret-is-at-least-32-bytes";

describe("beta application configuration and normalization", () => {
  it("defaults off and accepts only exact true/false flags with a distinct HMAC secret", () => {
    expect(betaApplicationsEnabled({})).toBe(false);
    expect(betaApplicationsEnabled({ KINRESOLVE_BETA_APPLICATIONS_ENABLED: "false" })).toBe(false);
    expect(() => betaApplicationsEnabled({ KINRESOLVE_BETA_APPLICATIONS_ENABLED: "TRUE" }))
      .toThrow(BetaApplicationError);
    expect(betaApplicationRuntimeConfiguration({
      KINRESOLVE_BETA_APPLICATIONS_ENABLED: "true",
      KINRESOLVE_BETA_APPLICATION_HMAC_SECRET: secret
    })).toEqual({ enabled: true, hmacSecret: secret });
    expect(() => betaApplicationRuntimeConfiguration({
      AUTH_SECRET: secret,
      KINRESOLVE_BETA_APPLICATIONS_ENABLED: "true",
      KINRESOLVE_BETA_APPLICATION_HMAC_SECRET: secret
    })).toThrow(BetaApplicationError);
  });

  it.each([
    "AI_API_KEY",
    "AUTH_SECRET",
    "BLOB_READ_WRITE_TOKEN",
    "CRON_SECRET",
    "KINRESOLVE_API_CURSOR_SECRET",
    "KINRESOLVE_BETA_PRIVACY_HMAC_SECRET",
    "KINRESOLVE_OBSERVABILITY_INGEST_SECRET",
    "KINRESOLVE_OBSERVABILITY_PROBE_SECRET",
    "KINSLEUTH_APP_PASSWORD",
    "MINIO_ROOT_PASSWORD",
    "MINIO_ROOT_USER",
    "OPENAI_API_KEY",
    "PGPASSWORD",
    "RECOVERY_AUTH_SECRET",
    "RECOVERY_BACKUP_S3_ACCESS_KEY_ID",
    "RECOVERY_BACKUP_S3_SECRET_ACCESS_KEY",
    "RECOVERY_TARGET_BLOB_READ_WRITE_TOKEN",
    "RECOVERY_TARGET_SUPABASE_ACCESS_TOKEN",
    "RELEASE_FENCE_SECRET",
    "RESEND_API_KEY",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VERCEL_AUTOMATION_BYPASS_SECRET",
    "VERCEL_TOKEN"
  ])("rejects an application HMAC secret reused from %s", (name) => {
    expect(() => betaApplicationRuntimeConfiguration({
      [name]: secret,
      KINRESOLVE_BETA_APPLICATIONS_ENABLED: "true",
      KINRESOLVE_BETA_APPLICATION_HMAC_SECRET: secret
    })).toThrow(BetaApplicationError);
  });

  it.each([
    "ADMIN_DATABASE_URL",
    "DATABASE_ADMIN_URL",
    "DATABASE_IDENTITY_URL",
    "DATABASE_URL",
    "DIRECT_DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "RECOVERY_DATABASE_URL",
    "RECOVERY_SOURCE_DATABASE_URL",
    "RECOVERY_TARGET_DATABASE_URL",
    "RECOVERY_TARGET_RUNTIME_DATABASE_URL",
    "RELEASE_FENCE_DATABASE_URL"
  ])("rejects an application HMAC secret reused as a credential inside %s", (name) => {
    const encodedSecret = encodeURIComponent(secret);
    for (const value of [
      `postgres://${encodedSecret}:other@db.example.test/kinresolve`,
      `postgresql://other:${encodedSecret}@db.example.test/kinresolve`
    ]) {
      expect(() => betaApplicationRuntimeConfiguration({
        [name]: value,
        KINRESOLVE_BETA_APPLICATIONS_ENABLED: "true",
        KINRESOLVE_BETA_APPLICATION_HMAC_SECRET: secret
      })).toThrow(BetaApplicationError);
    }
  });

  it("normalizes only fixed minimal fields and rejects free text or transport-incompatible email", () => {
    expect(normalizeBetaApplication({
      archiveSizeBand: "under-1000",
      consentVersion: "beta-communications-v1",
      currentTool: "gramps",
      email: " Pilot@Example.COM ",
      name: "  Pilot   Researcher  ",
      researcherType: "family-historian",
      workflow: "gedcom-review"
    })).toEqual({
      archiveSizeBand: "under-1000",
      consentVersion: "beta-communications-v1",
      currentTool: "gramps",
      email: "pilot@example.com",
      name: "Pilot Researcher",
      researcherType: "family-historian",
      workflow: "gedcom-review"
    });
    expect(() => normalizeBetaApplication({
      archiveSizeBand: "under-1000",
      consentVersion: "beta-communications-v1",
      currentTool: "My tree about the Smith family",
      email: "pilot@example.com",
      name: "Pilot Researcher",
      researcherType: "family-historian",
      workflow: "gedcom-review"
    })).toThrow(BetaApplicationError);
    expect(() => normalizeBetaApplication({
      archiveSizeBand: "under-1000",
      consentVersion: "beta-communications-v1",
      email: "pilot@exämple.test",
      name: "Pilot Researcher",
      researcherType: "family-historian",
      workflow: "gedcom-review"
    })).toThrow(BetaApplicationError);
  });

  it("domain-separates deterministic HMAC identities without retaining the subject", () => {
    const email = deriveBetaApplicationDigest("email", "pilot@example.com", secret);
    const submission = deriveBetaApplicationDigest("submission", "pilot@example.com", secret);
    expect(email).toMatch(/^[a-f0-9]{64}$/);
    expect(submission).toMatch(/^[a-f0-9]{64}$/);
    expect(email).not.toBe(submission);
    expect(email).not.toContain("pilot");
  });
});
