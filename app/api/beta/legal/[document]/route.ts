import type { NextRequest } from "next/server";

import { apiErrorResponse, createApiRequestId } from "@/lib/api-response";
import { evaluateBetaRateLimits } from "@/lib/beta-api-http";
import { fetchVerifiedBetaLegalDocument } from "@/lib/beta-legal-document-validation";
import {
  loadApprovedBetaLegalManifest,
  type ApprovedBetaLegalManifest,
  type BetaLegalDocument
} from "@/lib/beta-legal-manifest";
import { isHostedDeployment } from "@/lib/hosted-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ document: string }>;
};

const documentSelectors = {
  "participation-terms": (manifest: ApprovedBetaLegalManifest) => manifest.participationTerms,
  "privacy-notice": (manifest: ApprovedBetaLegalManifest) => manifest.privacyNotice,
  "beta-boundary": (manifest: ApprovedBetaLegalManifest) => manifest.betaBoundary
} as const satisfies Record<string, (manifest: ApprovedBetaLegalManifest) => BetaLegalDocument>;

export async function GET(request: NextRequest, { params }: RouteContext) {
  const requestId = createApiRequestId();
  try {
    if (!isHostedDeployment()) return unavailableResponse(404, requestId);
  } catch {
    return unavailableResponse(503, requestId);
  }

  const { document: documentName } = await params;
  const selectDocument = documentSelectors[documentName as keyof typeof documentSelectors];
  if (!selectDocument) return unavailableResponse(404, requestId);

  try {
    const limit = await evaluateBetaRateLimits(request, []);
    if (!limit.allowed) {
      return apiErrorResponse(429, "Too many requests. Try again later.", {
        requestId,
        headers: {
          "cache-control": "private, no-store",
          "retry-after": String(Math.max(1, limit.retryAfterSeconds))
        }
      });
    }

    const document = selectDocument(loadApprovedBetaLegalManifest());
    const verified = await fetchVerifiedBetaLegalDocument(document);
    const body = Buffer.from(verified.bytes);
    return new Response(body, {
      status: 200,
      headers: {
        "cache-control": "private, no-store",
        "content-digest": `sha-256=:${Buffer.from(document.sha256, "hex").toString("base64")}:`,
        "content-disposition": `inline; filename="${safeFilename(documentName, verified.contentType)}"`,
        "content-length": String(body.byteLength),
        "content-security-policy": "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "content-type": responseContentType(verified.contentType),
        "cross-origin-resource-policy": "same-origin",
        etag: `"${document.sha256}"`,
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "x-request-id": requestId
      }
    });
  } catch {
    return unavailableResponse(503, requestId);
  }
}

function unavailableResponse(status: 404 | 503, requestId: string) {
  return apiErrorResponse(status, status === 404 ? "Not found" : "Verified beta document unavailable.", {
    requestId,
    headers: { "cache-control": "private, no-store" }
  });
}

function responseContentType(value: string): string {
  return value.startsWith("text/") || value === "application/xhtml+xml"
    ? `${value}; charset=utf-8`
    : value;
}

function safeFilename(documentName: string, contentType: string): string {
  if (contentType === "application/pdf") return `${documentName}.pdf`;
  if (contentType === "text/markdown" || contentType === "text/x-markdown") return `${documentName}.md`;
  if (contentType === "text/html" || contentType === "application/xhtml+xml") return `${documentName}.html`;
  return `${documentName}.txt`;
}
