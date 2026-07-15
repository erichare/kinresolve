const versionPattern = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

export const approvedBetaLegalStatus = "approved" as const;

export type BetaLegalEnvironment = Record<string, string | undefined>;

export type BetaLegalDocument = Readonly<{
  sha256: string;
  title: string;
  url: string;
  version: string;
}>;

export type ApprovedBetaLegalManifest = Readonly<{
  betaBoundary: BetaLegalDocument;
  participationTerms: BetaLegalDocument;
  privacyNotice: BetaLegalDocument;
  status: typeof approvedBetaLegalStatus;
}>;

export type BetaLegalAcceptance = Readonly<{
  accepted: true;
  betaBoundarySha256: string;
  betaBoundaryUrl: string;
  betaBoundaryVersion: string;
  participationTermsSha256: string;
  participationTermsUrl: string;
  participationTermsVersion: string;
  privacyNoticeSha256: string;
  privacyNoticeUrl: string;
  privacyNoticeVersion: string;
}>;

export function loadApprovedBetaLegalManifest(
  environment: BetaLegalEnvironment = process.env
): ApprovedBetaLegalManifest {
  if (environment.KINRESOLVE_BETA_LEGAL_STATUS !== approvedBetaLegalStatus) {
    throw new Error("Approved private-beta legal metadata is not configured.");
  }

  return Object.freeze({
    status: approvedBetaLegalStatus,
    participationTerms: legalDocument(environment, {
      title: "Private beta participation terms",
      versionName: "KINRESOLVE_BETA_PARTICIPATION_TERMS_VERSION",
      sha256Name: "KINRESOLVE_BETA_PARTICIPATION_TERMS_SHA256",
      urlName: "KINRESOLVE_BETA_PARTICIPATION_TERMS_URL"
    }),
    privacyNotice: legalDocument(environment, {
      title: "Private beta privacy notice",
      versionName: "KINRESOLVE_BETA_PRIVACY_NOTICE_VERSION",
      sha256Name: "KINRESOLVE_BETA_PRIVACY_NOTICE_SHA256",
      urlName: "KINRESOLVE_BETA_PRIVACY_NOTICE_URL"
    }),
    betaBoundary: legalDocument(environment, {
      title: "Cohort-one beta boundary",
      versionName: "KINRESOLVE_BETA_BOUNDARY_VERSION",
      sha256Name: "KINRESOLVE_BETA_BOUNDARY_SHA256",
      urlName: "KINRESOLVE_BETA_BOUNDARY_URL"
    })
  });
}

export function currentBetaLegalAcceptance(
  manifest: ApprovedBetaLegalManifest
): BetaLegalAcceptance {
  return {
    participationTermsVersion: manifest.participationTerms.version,
    participationTermsSha256: manifest.participationTerms.sha256,
    participationTermsUrl: manifest.participationTerms.url,
    privacyNoticeVersion: manifest.privacyNotice.version,
    privacyNoticeSha256: manifest.privacyNotice.sha256,
    privacyNoticeUrl: manifest.privacyNotice.url,
    betaBoundaryVersion: manifest.betaBoundary.version,
    betaBoundarySha256: manifest.betaBoundary.sha256,
    betaBoundaryUrl: manifest.betaBoundary.url,
    accepted: true
  };
}

export function isCurrentBetaLegalAcceptance(
  value: unknown,
  manifest: ApprovedBetaLegalManifest
): value is BetaLegalAcceptance {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const acceptance = value as Partial<BetaLegalAcceptance>;
  const expected = currentBetaLegalAcceptance(manifest);
  return acceptance.accepted === true
    && acceptance.participationTermsVersion === expected.participationTermsVersion
    && acceptance.participationTermsSha256 === expected.participationTermsSha256
    && acceptance.participationTermsUrl === expected.participationTermsUrl
    && acceptance.privacyNoticeVersion === expected.privacyNoticeVersion
    && acceptance.privacyNoticeSha256 === expected.privacyNoticeSha256
    && acceptance.privacyNoticeUrl === expected.privacyNoticeUrl
    && acceptance.betaBoundaryVersion === expected.betaBoundaryVersion
    && acceptance.betaBoundarySha256 === expected.betaBoundarySha256
    && acceptance.betaBoundaryUrl === expected.betaBoundaryUrl;
}

function legalDocument(
  environment: BetaLegalEnvironment,
  input: {
    sha256Name: string;
    title: string;
    urlName: string;
    versionName: string;
  }
): BetaLegalDocument {
  const version = requiredValue(environment, input.versionName);
  const sha256 = requiredValue(environment, input.sha256Name);
  const url = requiredValue(environment, input.urlName);
  if (!versionPattern.test(version) || !sha256Pattern.test(sha256) || !isCanonicalHttpsDocumentUrl(url)) {
    throw new Error("Approved private-beta legal metadata is invalid.");
  }
  return Object.freeze({ title: input.title, version, sha256, url });
}

function requiredValue(environment: BetaLegalEnvironment, name: string): string {
  const value = environment[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error("Approved private-beta legal metadata is incomplete.");
  }
  return value;
}

function isCanonicalHttpsDocumentUrl(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && parsed.origin === "https://kinresolve.com"
      && parsed.username === ""
      && parsed.password === ""
      && parsed.search === ""
      && parsed.hash === ""
      && parsed.pathname !== "/"
      && parsed.href === value;
  } catch {
    return false;
  }
}
