const betaActionFragmentPattern = /^#token=([A-Za-z0-9_-]{16,512})$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const versionPattern = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const purposePattern = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$/;
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const betaInvitationErrorMessage =
  "This invitation is invalid, expired, or unavailable. Ask the Kin Resolve beta operator for a new invitation or contact beta@kinresolve.com.";

export const betaEmailVerificationErrorMessage =
  "This verification link is invalid, expired, or unavailable. Request a new verification email or contact beta@kinresolve.com.";

export const betaRoles = ["owner", "admin", "editor", "contributor", "viewer"] as const;
export type BetaRole = (typeof betaRoles)[number];

export type BetaLegalDocumentSummary = Readonly<{
  title: string;
  version: string;
  sha256: string;
  url: string;
}>;

export type BetaInvitationInspection = Readonly<{
  archiveName: string;
  role: BetaRole;
  purpose: string;
  expiresAt: string;
  legal: Readonly<{
    participationTerms: BetaLegalDocumentSummary;
    privacyNotice: BetaLegalDocumentSummary;
    betaBoundary: BetaLegalDocumentSummary;
  }>;
}>;

export type BetaLegalAcceptance = Readonly<{
  accepted: true;
  participationTermsVersion: string;
  participationTermsSha256: string;
  participationTermsUrl: string;
  privacyNoticeVersion: string;
  privacyNoticeSha256: string;
  privacyNoticeUrl: string;
  betaBoundaryVersion: string;
  betaBoundarySha256: string;
  betaBoundaryUrl: string;
}>;

export type BetaVerificationDelivery = "failed" | "sent";

/**
 * Accepts an action capability only from one exact URL fragment. Fragments do
 * not reach the server or referrer headers; callers must immediately replace
 * the browser history entry after reading it.
 */
export function betaActionTokenFromFragment(fragment: string): string | null {
  return betaActionFragmentPattern.exec(fragment)?.[1] ?? null;
}

export function betaRequestIdFromResponse(response: Pick<Response, "headers">): string | null {
  const requestId = response.headers.get("x-request-id")?.toLowerCase() ?? "";
  return requestIdPattern.test(requestId) ? requestId : null;
}

/**
 * Reads only the non-sensitive verification delivery outcome from a successful
 * invitation-acceptance response. A malformed response is treated as a failed
 * delivery so the browser never promises that an email was sent.
 */
export function betaVerificationDeliveryFromAcceptance(value: unknown): BetaVerificationDelivery {
  return isRecord(value) && value.verificationDelivery === "sent" ? "sent" : "failed";
}

/**
 * Projects an untrusted API response onto the intentionally small invitation
 * preview contract. Unknown fields—including any accidentally returned family
 * or account data—are discarded and can never enter component state.
 */
export function parseBetaInvitationInspection(value: unknown): BetaInvitationInspection | null {
  if (!isRecord(value) || !isRecord(value.legal)) return null;

  const archiveName = safeText(value.archiveName, 200);
  const role = typeof value.role === "string" && betaRoles.includes(value.role as BetaRole)
    ? value.role as BetaRole
    : null;
  const purpose = typeof value.purpose === "string" && purposePattern.test(value.purpose)
    ? value.purpose
    : null;
  const expiresAt = safeTimestamp(value.expiresAt);
  const participationTerms = parseLegalDocument(value.legal.participationTerms);
  const privacyNotice = parseLegalDocument(value.legal.privacyNotice);
  const betaBoundary = parseLegalDocument(value.legal.betaBoundary);

  if (!archiveName || !role || !purpose || !expiresAt || !participationTerms || !privacyNotice || !betaBoundary) {
    return null;
  }

  return {
    archiveName,
    role,
    purpose,
    expiresAt,
    legal: { participationTerms, privacyNotice, betaBoundary }
  };
}

export function betaLegalAcceptanceFromInspection(
  inspection: BetaInvitationInspection
): BetaLegalAcceptance {
  return {
    accepted: true,
    participationTermsVersion: inspection.legal.participationTerms.version,
    participationTermsSha256: inspection.legal.participationTerms.sha256,
    participationTermsUrl: inspection.legal.participationTerms.url,
    privacyNoticeVersion: inspection.legal.privacyNotice.version,
    privacyNoticeSha256: inspection.legal.privacyNotice.sha256,
    privacyNoticeUrl: inspection.legal.privacyNotice.url,
    betaBoundaryVersion: inspection.legal.betaBoundary.version,
    betaBoundarySha256: inspection.legal.betaBoundary.sha256,
    betaBoundaryUrl: inspection.legal.betaBoundary.url
  };
}

function parseLegalDocument(value: unknown): BetaLegalDocumentSummary | null {
  if (!isRecord(value)) return null;
  const title = safeText(value.title, 200);
  const version = typeof value.version === "string" && versionPattern.test(value.version)
    ? value.version
    : null;
  const sha256 = typeof value.sha256 === "string" && sha256Pattern.test(value.sha256)
    ? value.sha256
    : null;
  const url = safeLegalUrl(value.url);

  return title && version && sha256 && url ? { title, version, sha256, url } : null;
}

function safeLegalUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && url.pathname !== "/"
      && url.href === value
      ? value
      : null;
  } catch {
    return null;
  }
}

function safeTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 80) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function safeText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maximumLength || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
