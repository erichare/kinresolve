import { randomUUID } from "node:crypto";
import { verifyPassword } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  acceptBetaInvitation,
  deriveBetaPrivacyDigest,
  issueBetaInvitation,
  revokeBetaInvitation,
  verifyBetaEmail,
  type BetaInvitationServiceOptions
} from "@/lib/beta-invitations";
import {
  currentBetaLegalAcceptance,
  loadApprovedBetaLegalManifest
} from "@/lib/beta-legal-manifest";
import { consumeDurableAuthRateLimit } from "@/lib/durable-auth-rate-limit";
import { closeDatabasePools, query } from "@/lib/db";
import type { VerifiedOperatorRequest } from "@/lib/operator-signature";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;
// Keep this immutable-evidence fixture outside the broad `test-%` cleanup
// namespace used by older disposable-database suites. Beta evidence is
// intentionally append-only and cannot be deleted between test files.
const archiveId = `beta-invite-test-${randomUUID()}`;
const hmacSecret = "beta-invitation-test-private-hmac-secret-value";
const legalEnvironment = {
  KINRESOLVE_BETA_LEGAL_STATUS: "approved",
  KINRESOLVE_BETA_PARTICIPATION_TERMS_VERSION: "participation-v1",
  KINRESOLVE_BETA_PARTICIPATION_TERMS_SHA256: "1".repeat(64),
  KINRESOLVE_BETA_PARTICIPATION_TERMS_URL: "https://kinresolve.com/legal/private-beta-terms",
  KINRESOLVE_BETA_PRIVACY_NOTICE_VERSION: "privacy-v1",
  KINRESOLVE_BETA_PRIVACY_NOTICE_SHA256: "2".repeat(64),
  KINRESOLVE_BETA_PRIVACY_NOTICE_URL: "https://kinresolve.com/legal/private-beta-privacy",
  KINRESOLVE_BETA_BOUNDARY_VERSION: "boundary-v1",
  KINRESOLVE_BETA_BOUNDARY_SHA256: "3".repeat(64),
  KINRESOLVE_BETA_BOUNDARY_URL: "https://kinresolve.com/legal/cohort-one-boundary"
};
const legalAcceptance = currentBetaLegalAcceptance(loadApprovedBetaLegalManifest(legalEnvironment));
const options: BetaInvitationServiceOptions = {
  archiveId,
  databaseUrl: databaseUrl!,
  legalEnvironment,
  privacyHmacSecret: hmacSecret,
  validateLegalDocuments: async () => undefined
};

let previousControl: { reason_code: string; state: string } | undefined;

function operatorClaim(): VerifiedOperatorRequest {
  return {
    keyId: "test-operator",
    nonce: randomUUID(),
    requestDigest: randomUUID().replaceAll("-", "").padEnd(64, "0"),
    timestamp: new Date()
  };
}

function tokenFromActionUrl(actionUrl: string): string {
  const token = new URLSearchParams(new URL(actionUrl).hash.slice(1)).get("token");
  if (!token) throw new Error("Expected an action token.");
  return token;
}

beforeAll(async () => {
  if (!databaseUrl) return;
  await query(
    `INSERT INTO public.archives (id, name, slug)
     VALUES ($1, $2, $3)`,
    [archiveId, "Beta invitation test archive", archiveId],
    { databaseUrl }
  );
  const control = await query<{ reason_code: string; state: string }>(
    `SELECT state, reason_code
     FROM public.beta_invitation_control
     WHERE scope = 'hosted'`,
    [],
    { databaseUrl }
  );
  previousControl = control.rows[0];
  await query(
    `UPDATE public.beta_invitation_control
     SET state = 'active', reason_code = 'operator', updated_at = now()
     WHERE scope = 'hosted'`,
    [],
    { databaseUrl }
  );
});

afterAll(async () => {
  if (!databaseUrl) return;
  try {
    if (previousControl) {
      await query(
        `UPDATE public.beta_invitation_control
         SET state = $1, reason_code = $2, updated_at = now()
         WHERE scope = 'hosted'`,
        [previousControl.state, previousControl.reason_code],
        { databaseUrl }
      );
    }

    // This suite proves that ordinary UPDATE and DELETE operations cannot
    // rewrite evidence. The complete database command runs test files in one
    // disposable database, so use the migration-capable test connection to
    // reset only B3's evidence tables after those invariants have passed.
    // Production/runtime roles are not granted TRUNCATE.
    await query(
      `TRUNCATE TABLE
         public.beta_identity_audit_events,
         public.beta_terms_acceptances,
         public.beta_email_verification_tokens,
         public.beta_invitations,
         public.beta_operator_nonces,
         public.auth_rate_limit_buckets`,
      [],
      { databaseUrl }
    );
    await query(
      `DELETE FROM public."user"
       WHERE id IN (
         SELECT user_id FROM public.memberships WHERE archive_id = $1
       )`,
      [archiveId],
      { databaseUrl }
    );
    await query("DELETE FROM public.archives WHERE id = $1", [archiveId], { databaseUrl });
  } finally {
    await closeDatabasePools();
  }
});

describeIfDatabase("private-beta invitation database contract", () => {
  it("atomically consumes an initial-owner invite, records exact acceptance, and verifies email once", async () => {
    let invitationToken = "";
    const issued = await issueBetaInvitation({
      appBaseUrl: "https://app.kinresolve.com",
      deliver: async ({ actionUrl }) => {
        invitationToken = tokenFromActionUrl(actionUrl);
      },
      email: "Pilot.Owner@Example.com",
      expiresInSeconds: 3600,
      operator: operatorClaim(),
      purpose: "initial-owner",
      role: "owner"
    }, options);

    let verificationToken = "";
    const accepted = await acceptBetaInvitation({
      appBaseUrl: "https://app.kinresolve.com",
      deliverVerification: async ({ actionUrl }) => {
        verificationToken = tokenFromActionUrl(actionUrl);
      },
      email: "pilot.owner@example.com",
      legalAcceptance,
      name: "Pilot Owner",
      password: "a-long-password-123",
      requestId: randomUUID(),
      token: invitationToken
    }, options);

    expect(accepted).toMatchObject({
      purpose: "initial-owner",
      role: "owner",
      verificationDelivery: "sent",
      verificationRequired: true
    });
    const beforeVerification = await query<{
      emailVerified: boolean;
      invitation_token: string | null;
      password: string;
      state: string;
      verification_token: string | null;
    }>(
      `SELECT user_record."emailVerified",
              account.password,
              invitation.state,
              invitation.token_digest AS invitation_token,
              verification.token_digest AS verification_token
       FROM public.beta_invitations AS invitation
       JOIN public."user" AS user_record ON user_record.id = invitation.consumed_by_user_id
       JOIN public."account" AS account ON account."userId" = user_record.id
       JOIN public.beta_email_verification_tokens AS verification
         ON verification.invitation_id = invitation.id
       WHERE invitation.id = $1`,
      [issued.invitationId],
      { databaseUrl }
    );
    expect(beforeVerification.rows[0]).toMatchObject({
      emailVerified: false,
      state: "consumed",
      invitation_token: null
    });
    expect(beforeVerification.rows[0].verification_token).not.toBe(verificationToken);
    await expect(verifyPassword({
      hash: beforeVerification.rows[0].password,
      password: "a-long-password-123"
    })).resolves.toBe(true);

    await expect(verifyBetaEmail({ requestId: randomUUID(), token: verificationToken }, options)).resolves.toEqual({
      verified: true
    });
    await expect(verifyBetaEmail({ requestId: randomUUID(), token: verificationToken }, options)).rejects.toMatchObject({
      code: "VERIFICATION_UNAVAILABLE"
    });

    const evidence = await query<{
      acceptances: number;
      emailVerified: boolean;
      verification_state: string;
      verification_token: string | null;
    }>(
      `SELECT user_record."emailVerified",
              verification.state AS verification_state,
              verification.token_digest AS verification_token,
              (SELECT count(*)::int FROM public.beta_terms_acceptances
               WHERE invitation_id = $1) AS acceptances
       FROM public.beta_invitations AS invitation
       JOIN public."user" AS user_record ON user_record.id = invitation.consumed_by_user_id
       JOIN public.beta_email_verification_tokens AS verification
         ON verification.invitation_id = invitation.id
       WHERE invitation.id = $1`,
      [issued.invitationId],
      { databaseUrl }
    );
    expect(evidence.rows[0]).toEqual({
      acceptances: 1,
      emailVerified: true,
      verification_state: "consumed",
      verification_token: null
    });

    await expect(query(
      `UPDATE public.beta_terms_acceptances SET accepted_at = now() WHERE invitation_id = $1`,
      [issued.invitationId],
      { databaseUrl }
    )).rejects.toThrow(/append-only/);
    await expect(query(
      `DELETE FROM public.beta_identity_audit_events WHERE invitation_id = $1`,
      [issued.invitationId],
      { databaseUrl }
    )).rejects.toThrow(/append-only/);
  });

  it("allows exactly one initial-owner success", async () => {
    await expect(issueBetaInvitation({
      appBaseUrl: "https://app.kinresolve.com",
      deliver: vi.fn(),
      email: "second.owner@example.com",
      expiresInSeconds: 3600,
      operator: operatorClaim(),
      purpose: "initial-owner",
      role: "owner"
    }, options)).rejects.toMatchObject({ code: "INITIAL_OWNER_EXISTS" });
  });

  it("atomically revokes a failed delivery and permits an explicit fresh reissue", async () => {
    const email = `delivery-${randomUUID()}@example.com`;
    await expect(issueBetaInvitation({
      appBaseUrl: "https://app.kinresolve.com",
      deliver: async () => {
        throw new Error("synthetic provider failure");
      },
      email,
      expiresInSeconds: 3600,
      operator: operatorClaim(),
      purpose: "member",
      role: "viewer"
    }, options)).rejects.toMatchObject({ code: "DELIVERY_FAILED" });

    const emailDigest = deriveBetaPrivacyDigest({
      domain: "invitation-email",
      secret: hmacSecret,
      value: email
    });
    const failed = await query<{ state: string; token_digest: string | null }>(
      `SELECT state, token_digest
       FROM public.beta_invitations
       WHERE archive_id = $1 AND email_digest = $2
       ORDER BY issued_at DESC
       LIMIT 1`,
      [archiveId, emailDigest],
      { databaseUrl }
    );
    expect(failed.rows[0]).toEqual({ state: "revoked", token_digest: null });

    const reissued = await issueBetaInvitation({
      appBaseUrl: "https://app.kinresolve.com",
      deliver: vi.fn(),
      email,
      expiresInSeconds: 3600,
      operator: operatorClaim(),
      purpose: "member",
      role: "viewer"
    }, options);
    await revokeBetaInvitation({ invitationId: reissued.invitationId, operator: operatorClaim() }, options);
  });

  it("serializes concurrent acceptance so one token creates one account and one acceptance", async () => {
    const email = `race-${randomUUID()}@example.com`;
    let token = "";
    const issued = await issueBetaInvitation({
      appBaseUrl: "https://app.kinresolve.com",
      deliver: async ({ actionUrl }) => {
        token = tokenFromActionUrl(actionUrl);
      },
      email,
      expiresInSeconds: 3600,
      operator: operatorClaim(),
      purpose: "member",
      role: "editor"
    }, options);
    const deliverVerification = vi.fn(async () => undefined);
    const attempts = await Promise.allSettled([0, 1].map(() => acceptBetaInvitation({
      appBaseUrl: "https://app.kinresolve.com",
      deliverVerification,
      email,
      legalAcceptance,
      name: "Racing Member",
      password: "a-long-password-123",
      requestId: randomUUID(),
      token
    }, options)));

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejection = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejection).toMatchObject({ reason: { code: "INVITATION_UNAVAILABLE" } });
    expect(deliverVerification).toHaveBeenCalledTimes(1);
    const counts = await query<{ acceptances: number; accounts: number }>(
      `SELECT
         (SELECT count(*)::int FROM public.beta_terms_acceptances WHERE invitation_id = $1) AS acceptances,
         (SELECT count(*)::int FROM public."user" WHERE email = $2) AS accounts`,
      [issued.invitationId, email],
      { databaseUrl }
    );
    expect(counts.rows[0]).toEqual({ acceptances: 1, accounts: 1 });
  });

  it("revalidates approved document bytes immediately before acceptance and fails without mutation", async () => {
    const email = `legal-drift-${randomUUID()}@example.com`;
    let token = "";
    const issued = await issueBetaInvitation({
      appBaseUrl: "https://app.kinresolve.com",
      deliver: async ({ actionUrl }) => {
        token = tokenFromActionUrl(actionUrl);
      },
      email,
      expiresInSeconds: 3600,
      operator: operatorClaim(),
      purpose: "member",
      role: "viewer"
    }, options);

    await expect(acceptBetaInvitation({
      appBaseUrl: "https://app.kinresolve.com",
      deliverVerification: vi.fn(),
      email,
      legalAcceptance,
      name: "Legal Drift Member",
      password: "a-long-password-123",
      requestId: randomUUID(),
      token
    }, {
      ...options,
      validateLegalDocuments: async () => {
        throw new Error("synthetic digest mismatch");
      }
    })).rejects.toMatchObject({ code: "LEGAL_NOT_APPROVED" });

    const unchanged = await query<{ accounts: number; state: string; token_present: boolean }>(
      `SELECT invitation.state,
              invitation.token_digest IS NOT NULL AS token_present,
              (SELECT count(*)::int FROM public."user" WHERE email = $2) AS accounts
       FROM public.beta_invitations AS invitation
       WHERE invitation.id = $1`,
      [issued.invitationId, email],
      { databaseUrl }
    );
    expect(unchanged.rows[0]).toEqual({ accounts: 0, state: "pending", token_present: true });
    await revokeBetaInvitation({ invitationId: issued.invitationId, operator: operatorClaim() }, options);
  });

  it("rejects an unknown bearer before password hashing or legal-document fetches", async () => {
    const passwordHasher = vi.fn(async () => "must-not-run");
    const validateLegalDocuments = vi.fn(async () => undefined);

    await expect(acceptBetaInvitation({
      appBaseUrl: "https://app.kinresolve.com",
      deliverVerification: vi.fn(),
      email: `unknown-${randomUUID()}@example.com`,
      legalAcceptance,
      name: "Unknown Invitation",
      password: "a-long-password-123",
      requestId: randomUUID(),
      token: "A".repeat(43)
    }, {
      ...options,
      passwordHasher,
      validateLegalDocuments
    })).rejects.toMatchObject({ code: "INVITATION_UNAVAILABLE" });

    expect(passwordHasher).not.toHaveBeenCalled();
    expect(validateLegalDocuments).not.toHaveBeenCalled();
  });

  it("persists operator nonces and database-clock durable limits", async () => {
    const claim = operatorClaim();
    let token = "";
    const issued = await issueBetaInvitation({
      appBaseUrl: "https://app.kinresolve.com",
      deliver: async ({ actionUrl }) => {
        token = tokenFromActionUrl(actionUrl);
      },
      email: `nonce-${randomUUID()}@example.com`,
      expiresInSeconds: 3600,
      operator: claim,
      purpose: "member",
      role: "viewer"
    }, options);
    expect(token).not.toBe("");
    await expect(issueBetaInvitation({
      appBaseUrl: "https://app.kinresolve.com",
      deliver: vi.fn(),
      email: `replay-${randomUUID()}@example.com`,
      expiresInSeconds: 3600,
      operator: claim,
      purpose: "member",
      role: "viewer"
    }, options)).rejects.toMatchObject({ code: "OPERATOR_REPLAY" });
    await revokeBetaInvitation({ invitationId: issued.invitationId, operator: operatorClaim() }, options);

    const rateInput = {
      hmacSecret,
      maximumRequests: 2,
      scope: "beta/accept",
      subject: randomUUID(),
      windowSeconds: 60
    };
    await expect(consumeDurableAuthRateLimit(rateInput, { databaseUrl })).resolves.toMatchObject({
      allowed: true,
      remaining: 1
    });
    await expect(consumeDurableAuthRateLimit(rateInput, { databaseUrl })).resolves.toMatchObject({
      allowed: true,
      remaining: 0
    });
    await expect(consumeDurableAuthRateLimit(rateInput, { databaseUrl })).resolves.toMatchObject({
      allowed: false,
      remaining: 0
    });
  });
});
