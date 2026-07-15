import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  BetaLegalDocumentValidationError,
  betaLegalDocumentMaxAttempts,
  betaLegalDocumentMaxBytes,
  fetchVerifiedBetaLegalDocument,
  validateApprovedBetaLegalDocuments,
  type BetaLegalDocumentFetch
} from "@/lib/beta-legal-document-validation";
import {
  loadApprovedBetaLegalManifest,
  type ApprovedBetaLegalManifest
} from "@/lib/beta-legal-manifest";
import packageJson from "../package.json";

const encoder = new TextEncoder();

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixture() {
  const documents = {
    participationTerms: {
      bytes: encoder.encode("<!doctype html><title>Private beta terms</title>\n"),
      contentType: "text/html; charset=utf-8",
      url: "https://kinresolve.com/legal/private-beta-terms-v1.html"
    },
    privacyNotice: {
      bytes: encoder.encode("# Private beta privacy notice\n"),
      contentType: "text/markdown; charset=utf-8",
      url: "https://kinresolve.com/legal/private-beta-privacy-v1.md"
    },
    betaBoundary: {
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00, 0xff]),
      contentType: "application/pdf",
      url: "https://kinresolve.com/legal/cohort-one-boundary-v1.pdf"
    }
  } as const;

  const manifest = loadApprovedBetaLegalManifest({
    KINRESOLVE_BETA_LEGAL_STATUS: "approved",
    KINRESOLVE_BETA_PARTICIPATION_TERMS_VERSION: "private-beta-v1",
    KINRESOLVE_BETA_PARTICIPATION_TERMS_SHA256: sha256(documents.participationTerms.bytes),
    KINRESOLVE_BETA_PARTICIPATION_TERMS_URL: documents.participationTerms.url,
    KINRESOLVE_BETA_PRIVACY_NOTICE_VERSION: "private-beta-v1",
    KINRESOLVE_BETA_PRIVACY_NOTICE_SHA256: sha256(documents.privacyNotice.bytes),
    KINRESOLVE_BETA_PRIVACY_NOTICE_URL: documents.privacyNotice.url,
    KINRESOLVE_BETA_BOUNDARY_VERSION: "cohort-one-v1",
    KINRESOLVE_BETA_BOUNDARY_SHA256: sha256(documents.betaBoundary.bytes),
    KINRESOLVE_BETA_BOUNDARY_URL: documents.betaBoundary.url
  });

  return { documents, manifest };
}

function response(bytes: Uint8Array, contentType: string, status = 200): Response {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new Response(body.buffer, {
    status,
    headers: { "content-type": contentType }
  });
}

describe("approved private-beta legal document byte validation", () => {
  it("fetches each exact URL without redirects and verifies raw response bytes", async () => {
    const { documents, manifest } = fixture();
    const byUrl = new Map<string, (typeof documents)[keyof typeof documents]>(
      Object.values(documents).map((document) => [document.url, document])
    );
    const fetchImplementation = vi.fn<BetaLegalDocumentFetch>(async (input, init) => {
      const document = byUrl.get(String(input));
      if (!document) throw new Error("unexpected URL");
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("manual");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return response(document.bytes, document.contentType);
    });

    const result = await validateApprovedBetaLegalDocuments(manifest, {
      fetch: fetchImplementation,
      wait: async () => undefined
    });

    expect(result).toEqual([
      { title: "Private beta participation terms", status: "verified" },
      { title: "Private beta privacy notice", status: "verified" },
      { title: "Cohort-one beta boundary", status: "verified" }
    ]);
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(fetchImplementation.mock.calls.map(([input]) => String(input))).toEqual([
      manifest.participationTerms.url,
      manifest.privacyNotice.url,
      manifest.betaBoundary.url
    ]);
  });

  it("returns the exact bounded bytes and normalized media type for a same-origin view", async () => {
    const { documents, manifest } = fixture();
    const fetchImplementation = vi.fn<BetaLegalDocumentFetch>(async () => response(
      documents.privacyNotice.bytes,
      documents.privacyNotice.contentType
    ));

    const result = await fetchVerifiedBetaLegalDocument(manifest.privacyNotice, {
      fetch: fetchImplementation,
      maxAttempts: 1,
      wait: async () => undefined
    });

    expect(result.contentType).toBe("text/markdown");
    expect(result.bytes).toEqual(documents.privacyNotice.bytes);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["redirect", 302, "text/html", "redirects are not allowed"],
    ["unexpected status", 404, "text/html", "HTTP status 404"],
    ["unsafe content type", 200, "application/octet-stream; provider-secret=marker", "content type is not allowed"]
  ])("fails closed for %s without exposing provider text", async (_label, status, contentType, expected) => {
    const { manifest } = fixture();
    const providerLeak = "https://provider-secret.example/body?token=raw-secret";
    const providerResponse = new Response(providerLeak, {
      status,
      headers: {
        "content-type": contentType,
        location: providerLeak
      }
    });
    const text = vi.spyOn(providerResponse, "text");
    const error = await validateApprovedBetaLegalDocuments(manifest, {
      fetch: async () => providerResponse,
      maxAttempts: 1,
      wait: async () => undefined
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BetaLegalDocumentValidationError);
    expect(String(error)).toContain(expected);
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(providerLeak);
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(contentType);
    expect(text).not.toHaveBeenCalled();
  });

  it("rejects a digest mismatch without disclosing either digest or response bytes", async () => {
    const { documents, manifest } = fixture();
    const secretBody = encoder.encode("unexpected provider body with family-secret-marker");
    const actualDigest = sha256(secretBody);

    const error = await validateApprovedBetaLegalDocuments(manifest, {
      fetch: async () => response(secretBody, documents.participationTerms.contentType),
      maxAttempts: 1,
      wait: async () => undefined
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "digest-mismatch" });
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain("family-secret-marker");
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(actualDigest);
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(manifest.participationTerms.sha256);
  });

  it("rejects declared and streamed bodies above the fixed two-MiB ceiling", async () => {
    const { manifest } = fixture();
    const declaredBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encoder.encode("must-not-be-read"));
        controller.close();
      }
    });
    const declaredResponse = new Response(declaredBody, {
      headers: {
        "content-length": String(betaLegalDocumentMaxBytes + 1),
        "content-type": "text/plain"
      }
    });
    const getReader = vi.spyOn(declaredResponse.body!, "getReader");
    const declaredError = await validateApprovedBetaLegalDocuments(manifest, {
      fetch: async () => declaredResponse,
      maxAttempts: 1,
      wait: async () => undefined
    }).catch((caught: unknown) => caught);

    expect(declaredError).toMatchObject({ code: "body-too-large" });
    expect(getReader).not.toHaveBeenCalled();

    const oversizedBytes = new Uint8Array(betaLegalDocumentMaxBytes + 1);
    const streamedError = await validateApprovedBetaLegalDocuments(manifest, {
      fetch: async () => response(oversizedBytes, "text/plain"),
      maxAttempts: 1,
      wait: async () => undefined
    }).catch((caught: unknown) => caught);
    expect(streamedError).toMatchObject({ code: "body-too-large" });
  });

  it("uses bounded retries for transient failures without reading error bodies", async () => {
    const { documents, manifest } = fixture();
    const wait = vi.fn(async () => undefined);
    const transientResponse = new Response("provider-secret-response-text", {
      status: 503,
      headers: { "content-type": "text/plain" }
    });
    const text = vi.spyOn(transientResponse, "text");
    const fetchImplementation = vi.fn<BetaLegalDocumentFetch>()
      .mockRejectedValueOnce(new Error("network-provider-secret"))
      .mockResolvedValueOnce(transientResponse)
      .mockImplementation(async (input) => {
        const document = Object.values(documents).find((candidate) => candidate.url === String(input));
        if (!document) throw new Error("unexpected URL");
        return response(document.bytes, document.contentType);
      });

    await expect(validateApprovedBetaLegalDocuments(manifest, {
      fetch: fetchImplementation,
      maxAttempts: betaLegalDocumentMaxAttempts,
      wait
    })).resolves.toHaveLength(3);

    expect(fetchImplementation).toHaveBeenCalledTimes(5);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(text).not.toHaveBeenCalled();
  });

  it("bounds a hung request with an aborting timeout and returns a redacted error", async () => {
    const { manifest } = fixture();
    const providerLeak = "hung-provider-secret-url-and-body";
    const fetchImplementation: BetaLegalDocumentFetch = async (_input, init) => new Promise(
      (_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error(providerLeak)), { once: true });
      }
    );

    const error = await validateApprovedBetaLegalDocuments(manifest, {
      fetch: fetchImplementation,
      maxAttempts: 1,
      timeoutMs: 5,
      wait: async () => undefined
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "timed-out" });
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(providerLeak);
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(manifest.participationTerms.url);
  });

  it("rejects malformed approved metadata before making a request", async () => {
    const { manifest } = fixture();
    const fetchImplementation = vi.fn<BetaLegalDocumentFetch>();
    const malformed = {
      ...manifest,
      participationTerms: {
        ...manifest.participationTerms,
        sha256: "UPPERCASE-OR-SECRET"
      }
    } as ApprovedBetaLegalManifest;

    await expect(validateApprovedBetaLegalDocuments(malformed, {
      fetch: fetchImplementation,
      wait: async () => undefined
    })).rejects.toMatchObject({ code: "invalid-metadata" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

describe("private-beta legal document release gate", () => {
  it("provides a CLI that fails safely without echoing its environment-file path", () => {
    const secretPath = "/tmp/missing-private-beta-secret-path.env";
    const result = spawnSync(
      process.execPath,
      ["--no-warnings", "--experimental-strip-types", "scripts/validate-beta-legal-documents.mjs", secretPath],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Private beta legal document validation failed.");
    expect(result.stderr).not.toContain(secretPath);
  });

  it("runs immediately after both pulled-environment release-contract checks", async () => {
    const contents = await readFile(
      path.join(process.cwd(), ".github", "workflows", "vercel-release.yml"),
      "utf8"
    );
    const command = "npm run beta:legal:validate -- .vercel/.env.production.local";
    expect(packageJson.scripts["beta:legal:validate"]).toBe(
      "node --experimental-strip-types scripts/validate-beta-legal-documents.mjs"
    );
    expect(contents.split(command)).toHaveLength(3);

    for (const [contract, nextStep] of [
      ["Validate staging release contract", "Attest the staging runtime database role"],
      ["Validate production release contract", "Attest the production runtime database role"]
    ]) {
      const contractPosition = contents.indexOf(contract);
      const validationPosition = contents.indexOf(command, contractPosition);
      const nextStepPosition = contents.indexOf(nextStep, contractPosition);
      expect(contractPosition).toBeGreaterThan(0);
      expect(validationPosition).toBeGreaterThan(contractPosition);
      expect(validationPosition).toBeLessThan(nextStepPosition);
    }
  });
});
