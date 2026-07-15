import { createHash } from "node:crypto";

import {
  approvedBetaLegalStatus,
  type ApprovedBetaLegalManifest,
  type BetaLegalDocument
} from "./beta-legal-manifest.ts";

export const betaLegalDocumentMaxBytes = 2 * 1024 * 1024;
export const betaLegalDocumentTimeoutMs = 10_000;
export const betaLegalDocumentMaxAttempts = 3;

const sha256Pattern = /^[a-f0-9]{64}$/;
const versionPattern = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const allowedContentTypes = new Set([
  "application/pdf",
  "application/xhtml+xml",
  "text/html",
  "text/markdown",
  "text/plain",
  "text/x-markdown"
]);
const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

export type SafeBetaLegalDocumentTitle =
  | "Private beta participation terms"
  | "Private beta privacy notice"
  | "Cohort-one beta boundary";

export type BetaLegalDocumentFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export type BetaLegalDocumentValidationResult = Readonly<{
  status: "verified";
  title: SafeBetaLegalDocumentTitle;
}>;

export type VerifiedBetaLegalDocument = Readonly<{
  bytes: Uint8Array;
  contentType: string;
}>;

export type BetaLegalDocumentValidationErrorCode =
  | "body-empty"
  | "body-too-large"
  | "body-unavailable"
  | "content-type-not-allowed"
  | "digest-mismatch"
  | "http-status"
  | "invalid-metadata"
  | "invalid-response"
  | "redirect-not-allowed"
  | "request-failed"
  | "timed-out";

export class BetaLegalDocumentValidationError extends Error {
  readonly code: BetaLegalDocumentValidationErrorCode;
  readonly documentTitle: SafeBetaLegalDocumentTitle;
  readonly status?: number;

  constructor(
    documentTitle: SafeBetaLegalDocumentTitle,
    code: BetaLegalDocumentValidationErrorCode,
    status?: number
  ) {
    super(validationErrorMessage(documentTitle, code, status));
    this.name = "BetaLegalDocumentValidationError";
    this.code = code;
    this.documentTitle = documentTitle;
    this.status = status;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      documentTitle: this.documentTitle,
      message: this.message,
      ...(this.status === undefined ? {} : { status: this.status })
    };
  }
}

type ValidationOptions = Readonly<{
  fetch?: BetaLegalDocumentFetch;
  maxAttempts?: number;
  timeoutMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
}>;

type AttemptFailureCode = "http-status" | "request-failed" | "timed-out";

class AttemptFailure extends Error {
  readonly code: AttemptFailureCode;
  readonly status?: number;

  constructor(code: AttemptFailureCode, status?: number) {
    super("Legal document fetch attempt failed.");
    this.code = code;
    this.status = status;
  }
}

export async function validateApprovedBetaLegalDocuments(
  manifest: ApprovedBetaLegalManifest,
  options: ValidationOptions = {}
): Promise<readonly BetaLegalDocumentValidationResult[]> {
  const dependencies = validationDependencies(options);
  const documents = manifestDocuments(manifest);
  const results: BetaLegalDocumentValidationResult[] = [];
  for (const entry of documents) {
    assertDocumentMetadata(entry.document, entry.title, manifest.status);
    await validateDocument(entry.document, entry.title, dependencies, false);
    results.push(Object.freeze({ title: entry.title, status: "verified" }));
  }
  return Object.freeze(results);
}

export async function fetchVerifiedBetaLegalDocument(
  document: BetaLegalDocument,
  options: ValidationOptions = {}
): Promise<VerifiedBetaLegalDocument> {
  const title = safeDocumentTitle(document);
  assertDocumentMetadata(document, title, approvedBetaLegalStatus);
  const response = await validateDocument(
    document,
    title,
    validationDependencies(options),
    true
  );
  if (!response.bytes) {
    throw new BetaLegalDocumentValidationError(title, "body-unavailable");
  }
  return {
    bytes: response.bytes,
    contentType: response.contentType
  };
}

function safeDocumentTitle(document: BetaLegalDocument): SafeBetaLegalDocumentTitle {
  if (
    document?.title === "Private beta participation terms"
    || document?.title === "Private beta privacy notice"
    || document?.title === "Cohort-one beta boundary"
  ) {
    return document.title;
  }
  throw new BetaLegalDocumentValidationError(
    "Private beta participation terms",
    "invalid-metadata"
  );
}

function validationDependencies(options: ValidationOptions): Readonly<{
  fetchImplementation: BetaLegalDocumentFetch;
  maxAttempts: number;
  timeoutMs: number;
  wait: (milliseconds: number) => Promise<void>;
}> {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const maxAttempts = options.maxAttempts ?? betaLegalDocumentMaxAttempts;
  const timeoutMs = options.timeoutMs ?? betaLegalDocumentTimeoutMs;
  const wait = options.wait ?? waitFor;
  if (
    typeof fetchImplementation !== "function"
    || !Number.isInteger(maxAttempts)
    || maxAttempts < 1
    || maxAttempts > betaLegalDocumentMaxAttempts
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > 60_000
    || typeof wait !== "function"
  ) {
    throw new Error("Private beta legal document validation options are invalid.");
  }
  return { fetchImplementation, maxAttempts, timeoutMs, wait };
}

function manifestDocuments(manifest: ApprovedBetaLegalManifest): readonly Readonly<{
  document: BetaLegalDocument;
  title: SafeBetaLegalDocumentTitle;
}>[] {
  if (typeof manifest !== "object" || manifest === null) {
    throw new BetaLegalDocumentValidationError(
      "Private beta participation terms",
      "invalid-metadata"
    );
  }
  return [
    {
      title: "Private beta participation terms",
      document: manifest.participationTerms
    },
    {
      title: "Private beta privacy notice",
      document: manifest.privacyNotice
    },
    {
      title: "Cohort-one beta boundary",
      document: manifest.betaBoundary
    }
  ];
}

function assertDocumentMetadata(
  document: BetaLegalDocument,
  expectedTitle: SafeBetaLegalDocumentTitle,
  status: ApprovedBetaLegalManifest["status"]
): void {
  if (
    status !== approvedBetaLegalStatus
    || typeof document !== "object"
    || document === null
    || document.title !== expectedTitle
    || !versionPattern.test(document.version)
    || !sha256Pattern.test(document.sha256)
    || !isCanonicalHttpsDocumentUrl(document.url)
  ) {
    throw new BetaLegalDocumentValidationError(expectedTitle, "invalid-metadata");
  }
}

async function validateDocument(
  document: BetaLegalDocument,
  title: SafeBetaLegalDocumentTitle,
  options: Readonly<{
    fetchImplementation: BetaLegalDocumentFetch;
    maxAttempts: number;
    timeoutMs: number;
    wait: (milliseconds: number) => Promise<void>;
  }>,
  captureBytes: boolean
): Promise<ValidatedDocumentResponse> {
  let lastFailure = new AttemptFailure("request-failed");
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await validateDocumentAttempt(
        document,
        title,
        options.fetchImplementation,
        options.timeoutMs,
        captureBytes
      );
    } catch (error) {
      if (error instanceof BetaLegalDocumentValidationError) throw error;
      lastFailure = error instanceof AttemptFailure
        ? error
        : new AttemptFailure("request-failed");
    }

    if (attempt < options.maxAttempts) {
      await options.wait(retryDelayMilliseconds(attempt));
    }
  }

  throw new BetaLegalDocumentValidationError(
    title,
    lastFailure.code,
    lastFailure.status
  );
}

async function validateDocumentAttempt(
  document: BetaLegalDocument,
  title: SafeBetaLegalDocumentTitle,
  fetchImplementation: BetaLegalDocumentFetch,
  timeoutMs: number,
  captureBytes: boolean
): Promise<ValidatedDocumentResponse> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const operation = performDocumentRequest(
    document,
    title,
    fetchImplementation,
    controller.signal,
    captureBytes
  ).catch((error: unknown) => {
    if (error instanceof BetaLegalDocumentValidationError || error instanceof AttemptFailure) {
      throw error;
    }
    throw new AttemptFailure(controller.signal.aborted ? "timed-out" : "request-failed");
  });
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new AttemptFailure("timed-out"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

async function performDocumentRequest(
  document: BetaLegalDocument,
  title: SafeBetaLegalDocumentTitle,
  fetchImplementation: BetaLegalDocumentFetch,
  signal: AbortSignal,
  captureBytes: boolean
): Promise<ValidatedDocumentResponse> {
  const response = await fetchImplementation(document.url, {
    method: "GET",
    redirect: "manual",
    signal,
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: {
      Accept: "text/html, application/xhtml+xml, text/plain, text/markdown, application/pdf"
    }
  });

  if (!isResponseLike(response)) throw new AttemptFailure("request-failed");
  const status = response.status;
  if (
    response.type === "opaqueredirect"
    || response.redirected
    || (response.url !== "" && response.url !== document.url)
    || (status >= 300 && status <= 399)
  ) {
    await cancelResponse(response);
    throw new BetaLegalDocumentValidationError(title, "redirect-not-allowed", status);
  }
  if (status < 200 || status > 299) {
    await cancelResponse(response);
    if (retryableStatuses.has(status)) throw new AttemptFailure("http-status", status);
    throw new BetaLegalDocumentValidationError(title, "http-status", status);
  }

  const contentTypeHeader = safeHeader(response, "content-type");
  const contentType = contentTypeHeader === null ? "" : mediaType(contentTypeHeader);
  if (!allowedContentTypes.has(contentType)) {
    await cancelResponse(response);
    throw new BetaLegalDocumentValidationError(title, "content-type-not-allowed");
  }

  const contentLength = safeHeader(response, "content-length");
  if (contentLength !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(contentLength)) {
      await cancelResponse(response);
      throw new BetaLegalDocumentValidationError(title, "invalid-response");
    }
    if (BigInt(contentLength) > BigInt(betaLegalDocumentMaxBytes)) {
      await cancelResponse(response);
      throw new BetaLegalDocumentValidationError(title, "body-too-large");
    }
  }

  const body = await digestBody(response.body, title, captureBytes);
  if (body.sha256 !== document.sha256) {
    throw new BetaLegalDocumentValidationError(title, "digest-mismatch");
  }
  return {
    ...(body.bytes === undefined ? {} : { bytes: body.bytes }),
    contentType
  };
}

type ValidatedDocumentResponse = {
  bytes?: Uint8Array;
  contentType: string;
};

async function digestBody(
  body: ReadableStream<Uint8Array> | null,
  title: SafeBetaLegalDocumentTitle,
  captureBytes: boolean
): Promise<{ bytes?: Uint8Array; sha256: string }> {
  if (body === null || typeof body.getReader !== "function") {
    throw new BetaLegalDocumentValidationError(title, "body-unavailable");
  }

  const reader = body.getReader();
  const digest = createHash("sha256");
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) {
        throw new BetaLegalDocumentValidationError(title, "invalid-response");
      }
      bytesRead += chunk.value.byteLength;
      if (bytesRead > betaLegalDocumentMaxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Cancellation failure does not change the safe validation result.
        }
        throw new BetaLegalDocumentValidationError(title, "body-too-large");
      }
      digest.update(chunk.value);
      if (captureBytes) chunks.push(new Uint8Array(chunk.value));
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The validation result remains fail-closed if the stream already ended.
    }
  }

  if (bytesRead === 0) {
    throw new BetaLegalDocumentValidationError(title, "body-empty");
  }
  if (!captureBytes) return { sha256: digest.digest("hex") };
  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, sha256: digest.digest("hex") };
}

function isResponseLike(value: unknown): value is Response {
  return typeof value === "object"
    && value !== null
    && "status" in value
    && Number.isInteger((value as { status?: unknown }).status)
    && (value as { status: number }).status >= 100
    && (value as { status: number }).status <= 599
    && "headers" in value;
}

function safeHeader(response: Response, name: string): string | null {
  try {
    return response.headers.get(name);
  } catch {
    throw new AttemptFailure("request-failed");
  }
}

async function cancelResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Provider cancellation errors are untrusted and intentionally discarded.
  }
}

function mediaType(contentType: string): string {
  return contentType.split(";", 1)[0].trim().toLowerCase();
}

function retryDelayMilliseconds(failedAttempt: number): number {
  return failedAttempt * 250;
}

async function waitFor(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isCanonicalHttpsDocumentUrl(value: string): boolean {
  if (typeof value !== "string" || value === "" || value !== value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
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

function validationErrorMessage(
  title: SafeBetaLegalDocumentTitle,
  code: BetaLegalDocumentValidationErrorCode,
  status?: number
): string {
  if (code === "http-status") {
    return `${title}: HTTP status ${status ?? "invalid"}.`;
  }
  const detail: Record<Exclude<BetaLegalDocumentValidationErrorCode, "http-status">, string> = {
    "body-empty": "response body is empty",
    "body-too-large": "response body exceeds the two-MiB limit",
    "body-unavailable": "response body is unavailable",
    "content-type-not-allowed": "content type is not allowed",
    "digest-mismatch": "response digest does not match approved metadata",
    "invalid-metadata": "approved metadata is invalid",
    "invalid-response": "provider response metadata is invalid",
    "redirect-not-allowed": "redirects are not allowed",
    "request-failed": "request failed",
    "timed-out": "request timed out"
  };
  return `${title}: ${detail[code]}.`;
}
