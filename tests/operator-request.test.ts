import { generateKeyPairSync, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateOperatorRequest, OperatorRequestError } from "@/lib/operator-request";
import { operatorSignatureHeaders, signOperatorRequest } from "@/lib/operator-signature";

const url = "https://app.kinresolve.com/api/operator/invitations";

function keys() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    publicKey: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64url")
  };
}

function signedRequest(body: string, privateKey: string): NextRequest {
  const fields = signOperatorRequest({
    audience: "https://app.kinresolve.com",
    body,
    keyId: "beta-operator-1",
    method: "POST",
    nonce: randomUUID(),
    pathname: "/api/operator/invitations",
    privateKeyPkcs8Base64Url: privateKey,
    timestamp: String(Math.floor(Date.now() / 1000))
  });
  return new NextRequest(url, {
    body,
    headers: {
      "content-type": "application/json",
      [operatorSignatureHeaders.audience]: fields.audience,
      [operatorSignatureHeaders.keyId]: fields.keyId,
      [operatorSignatureHeaders.nonce]: fields.nonce,
      [operatorSignatureHeaders.signature]: fields.signature,
      [operatorSignatureHeaders.timestamp]: fields.timestamp
    },
    method: "POST"
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("operator HTTP request authentication", () => {
  it("returns the exact signed body and a replay claim", async () => {
    const key = keys();
    vi.stubEnv("KINRESOLVE_BETA_OPERATOR_KEY_ID", "beta-operator-1");
    vi.stubEnv("KINRESOLVE_BETA_OPERATOR_AUDIENCE", "https://app.kinresolve.com");
    vi.stubEnv("KINRESOLVE_BETA_OPERATOR_PUBLIC_KEY_SPKI", key.publicKey);
    const body = JSON.stringify({ email: "pilot@example.test" });

    const result = await authenticateOperatorRequest(signedRequest(body, key.privateKey));

    expect(result.body).toBe(body);
    expect(result.claim).toMatchObject({
      keyId: "beta-operator-1",
      requestDigest: expect.stringMatching(/^[0-9a-f]{64}$/)
    });
  });

  it("fails closed when operator authentication is not configured", async () => {
    const key = keys();
    await expect(authenticateOperatorRequest(signedRequest("{}", key.privateKey))).rejects.toMatchObject({
      code: "MISCONFIGURED"
    });
  });

  it("rejects body tampering and oversized declared bodies", async () => {
    const key = keys();
    vi.stubEnv("KINRESOLVE_BETA_OPERATOR_KEY_ID", "beta-operator-1");
    vi.stubEnv("KINRESOLVE_BETA_OPERATOR_AUDIENCE", "https://app.kinresolve.com");
    vi.stubEnv("KINRESOLVE_BETA_OPERATOR_PUBLIC_KEY_SPKI", key.publicKey);
    const request = signedRequest("{}", key.privateKey);
    const headers = new Headers(request.headers);

    await expect(authenticateOperatorRequest(new NextRequest(url, {
      body: '{"changed":true}',
      headers,
      method: "POST"
    }))).rejects.toBeInstanceOf(OperatorRequestError);

    headers.set("content-length", String(16 * 1024 + 1));
    await expect(authenticateOperatorRequest(new NextRequest(url, {
      body: "{}",
      headers,
      method: "POST"
    }))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("rejects a valid signature from another deployment audience", async () => {
    const key = keys();
    vi.stubEnv("KINRESOLVE_BETA_OPERATOR_KEY_ID", "beta-operator-1");
    vi.stubEnv("KINRESOLVE_BETA_OPERATOR_AUDIENCE", "https://staging.kinresolve.com");
    vi.stubEnv("KINRESOLVE_BETA_OPERATOR_PUBLIC_KEY_SPKI", key.publicKey);

    await expect(authenticateOperatorRequest(signedRequest("{}", key.privateKey)))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});
