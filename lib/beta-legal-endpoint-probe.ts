import { createHash } from "node:crypto";

import {
  betaLegalDocumentMaxBytes,
  fetchVerifiedBetaLegalDocument
} from "./beta-legal-document-validation.ts";
import {
  loadApprovedBetaLegalManifest,
  type BetaLegalDocument,
  type BetaLegalEnvironment
} from "./beta-legal-manifest.ts";

type ProbeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type BetaLegalEndpointProbeInput = {
  origin: string;
  environment?: BetaLegalEnvironment;
  bypassSecret?: string;
  fetch?: ProbeFetch;
  sourceFetch?: ProbeFetch;
};

export type BetaLegalEndpointProbeResult = Readonly<{
  document: "participation-terms" | "privacy-notice" | "beta-boundary";
  status: "verified";
}>;

export async function probeBetaLegalEndpoints(
  input: BetaLegalEndpointProbeInput
): Promise<readonly BetaLegalEndpointProbeResult[]> {
  const origin = exactHttpsOrigin(input.origin);
  const manifest = loadApprovedBetaLegalManifest(input.environment);
  const fetchImplementation = input.fetch ?? globalThis.fetch;
  const sourceFetchImplementation = input.sourceFetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function" || typeof sourceFetchImplementation !== "function") {
    throw proofError();
  }
  const bypassSecret = input.bypassSecret?.trim() ?? "";
  if (input.bypassSecret !== undefined && bypassSecret !== input.bypassSecret) throw proofError();

  const documents = [
    ["participation-terms", manifest.participationTerms],
    ["privacy-notice", manifest.privacyNotice],
    ["beta-boundary", manifest.betaBoundary]
  ] as const;
  const results: BetaLegalEndpointProbeResult[] = [];
  for (const [name, document] of documents) {
    let sourceContentType: string;
    try {
      sourceContentType = (await fetchVerifiedBetaLegalDocument(document, {
        fetch: sourceFetchImplementation
      })).contentType;
    } catch {
      throw proofError();
    }
    await probeDocument(
      origin,
      name,
      document,
      sourceContentType,
      bypassSecret,
      fetchImplementation
    );
    results.push(Object.freeze({ document: name, status: "verified" }));
  }
  return Object.freeze(results);
}

async function probeDocument(
  origin: string,
  name: BetaLegalEndpointProbeResult["document"],
  document: BetaLegalDocument,
  sourceContentType: string,
  bypassSecret: string,
  fetchImplementation: ProbeFetch
): Promise<void> {
  let response: Response;
  try {
    response = await fetchImplementation(`${origin}/api/beta/legal/${name}`, {
      cache: "no-store",
      redirect: "manual",
      headers: bypassSecret === "" ? undefined : {
        "x-vercel-protection-bypass": bypassSecret
      },
      signal: AbortSignal.timeout(30_000)
    });
  } catch {
    throw proofError();
  }
  if (response.status !== 200 || response.redirected) throw proofError();
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw proofError();
  }
  if (bytes.byteLength === 0 || bytes.byteLength > betaLegalDocumentMaxBytes) throw proofError();
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  const expectedContentDigest = `sha-256=:${Buffer.from(document.sha256, "hex").toString("base64")}:`;
  const expectedContentType = responseContentType(sourceContentType);
  const expectedDisposition = `inline; filename="${safeFilename(name, sourceContentType)}"`;
  if (actualSha256 !== document.sha256
      || response.headers.get("content-digest") !== expectedContentDigest
      || response.headers.get("etag") !== `"${document.sha256}"`
      || response.headers.get("cache-control") !== "private, no-store"
      || response.headers.get("content-type") !== expectedContentType
      || response.headers.get("content-disposition") !== expectedDisposition
      || response.headers.get("content-length") !== String(bytes.byteLength)
      || response.headers.get("content-security-policy")
        !== "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      || response.headers.get("cross-origin-resource-policy") !== "same-origin"
      || response.headers.get("referrer-policy") !== "no-referrer"
      || response.headers.get("x-content-type-options") !== "nosniff"
      || response.headers.get("x-frame-options") !== "DENY") {
    throw proofError();
  }
}

function responseContentType(value: string): string {
  return value.startsWith("text/") || value === "application/xhtml+xml"
    ? `${value}; charset=utf-8`
    : value;
}

function safeFilename(name: BetaLegalEndpointProbeResult["document"], contentType: string): string {
  if (contentType === "application/pdf") return `${name}.pdf`;
  if (contentType === "text/markdown" || contentType === "text/x-markdown") {
    return `${name}.md`;
  }
  if (contentType === "text/html" || contentType === "application/xhtml+xml") {
    return `${name}.html`;
  }
  return `${name}.txt`;
}

function exactHttpsOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The legal endpoint probe origin is invalid.");
  }
  if (url.protocol !== "https:"
      || url.origin !== value
      || url.username !== ""
      || url.password !== ""
      || url.port !== "") {
    throw new Error("The legal endpoint probe origin is invalid.");
  }
  return url.origin;
}

function proofError(): Error {
  return new Error("Live beta legal endpoint proof failed.");
}
