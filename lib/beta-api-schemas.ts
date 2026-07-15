import { z } from "zod";

const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const email = z.string().trim().email().max(320);
const version = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const documentUrl = z.string().url().max(2048).refine((value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
      && parsed.pathname !== "/"
      && parsed.href === value;
  } catch {
    return false;
  }
});

export const betaTokenBodySchema = z.object({ token }).strict();

export const betaInvitationAcceptanceSchema = z.object({
  token,
  name: z.string().trim().min(1).max(100),
  email,
  password: z.string().min(10).max(128),
  acceptance: z.object({
    accepted: z.literal(true),
    participationTermsVersion: version,
    participationTermsSha256: sha256,
    participationTermsUrl: documentUrl,
    privacyNoticeVersion: version,
    privacyNoticeSha256: sha256,
    privacyNoticeUrl: documentUrl,
    betaBoundaryVersion: version,
    betaBoundarySha256: sha256,
    betaBoundaryUrl: documentUrl
  }).strict()
}).strict();

export const betaVerificationReissueSchema = z.object({ email }).strict();
