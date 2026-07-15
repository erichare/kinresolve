import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  operatorSignatureHeaders,
  readOperatorSignatureHeaders,
  signOperatorRequest,
  validateOperatorPublicKeyConfiguration,
  verifyOperatorRequest
} from "@/lib/operator-signature";

const now = new Date("2026-07-15T13:00:00.000Z");
const timestamp = String(Math.floor(now.getTime() / 1000));
const body = JSON.stringify({ email: "pilot@example.test" });
const pathname = "/api/operator/invitations";
const audience = "https://app.kinresolve.com";

function keys() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    publicKey: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64url")
  };
}

describe("operator request signatures", () => {
  it("authenticates one exact method, path, body, timestamp, nonce, and key", () => {
    const key = keys();
    const signed = signOperatorRequest({
      audience,
      body,
      keyId: "beta-operator-1",
      method: "POST",
      nonce: randomUUID(),
      pathname,
      privateKeyPkcs8Base64Url: key.privateKey,
      timestamp
    });

    expect(verifyOperatorRequest({
      body,
      expectedAudience: audience,
      expectedKeyId: "beta-operator-1",
      fields: signed,
      method: "POST",
      now,
      pathname,
      publicKeySpkiBase64Url: key.publicKey
    })).toEqual({
      keyId: "beta-operator-1",
      nonce: signed.nonce,
      requestDigest: "747dbb7a3503e78edb5ef40c82a5d9529072d84c3563f2c374990f67bf8ee6fa",
      timestamp: now
    });
  });

  it.each([
    ["body", { body: JSON.stringify({ email: "other@example.test" }) }],
    ["method", { method: "DELETE" }],
    ["path", { pathname: "/api/operator/invitations/control" }]
  ])("rejects a signature replayed with a different %s", (_label, change) => {
    const key = keys();
    const signed = signOperatorRequest({
      audience,
      body,
      keyId: "beta-operator-1",
      method: "POST",
      nonce: randomUUID(),
      pathname,
      privateKeyPkcs8Base64Url: key.privateKey,
      timestamp
    });

    expect(() => verifyOperatorRequest({
      body,
      expectedAudience: audience,
      expectedKeyId: "beta-operator-1",
      fields: signed,
      method: "POST",
      now,
      pathname,
      publicKeySpkiBase64Url: key.publicKey,
      ...change
    })).toThrow(/signature/i);
  });

  it("rejects stale requests, unauthorized keys, malformed values, and non-operator paths", () => {
    const key = keys();
    const signed = signOperatorRequest({
      audience,
      body,
      keyId: "beta-operator-1",
      method: "POST",
      nonce: randomUUID(),
      pathname,
      privateKeyPkcs8Base64Url: key.privateKey,
      timestamp
    });
    const common = {
      body,
      expectedAudience: audience,
      expectedKeyId: "beta-operator-1",
      fields: signed,
      method: "POST",
      pathname,
      publicKeySpkiBase64Url: key.publicKey
    };

    expect(() => verifyOperatorRequest({ ...common, now: new Date(now.getTime() + 301_000) })).toThrow(/expired/i);
    expect(() => verifyOperatorRequest({ ...common, expectedKeyId: "beta-operator-2", now })).toThrow(/not authorized/i);
    expect(() => verifyOperatorRequest({ ...common, expectedAudience: "https://staging.kinresolve.com", now }))
      .toThrow(/audience.*not authorized/i);
    expect(() => verifyOperatorRequest({
      ...common,
      fields: { ...signed, nonce: "not-a-nonce" },
      now
    })).toThrow(/nonce/i);
    expect(() => verifyOperatorRequest({ ...common, now, pathname: "/api/health" })).toThrow(/path/i);
  });

  it("maps the five required headers without accepting aliases", () => {
    const headers = new Headers({
      [operatorSignatureHeaders.audience]: audience,
      [operatorSignatureHeaders.keyId]: "beta-operator-1",
      [operatorSignatureHeaders.nonce]: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      [operatorSignatureHeaders.signature]: "a".repeat(86),
      [operatorSignatureHeaders.timestamp]: timestamp,
      "x-operator-signature": "ignored"
    });

    expect(readOperatorSignatureHeaders(headers)).toEqual({
      audience,
      keyId: "beta-operator-1",
      nonce: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      signature: "a".repeat(86),
      timestamp
    });
  });

  it("validates an exact Ed25519 runtime public-key configuration", () => {
    const key = keys();
    expect(() => validateOperatorPublicKeyConfiguration({
      audience,
      keyId: "beta-operator-1",
      publicKeySpkiBase64Url: key.publicKey
    })).not.toThrow();
    expect(() => validateOperatorPublicKeyConfiguration({
      audience,
      keyId: "bad key id",
      publicKeySpkiBase64Url: key.publicKey
    })).toThrow(/key ID/i);
    expect(() => validateOperatorPublicKeyConfiguration({
      audience,
      keyId: "beta-operator-1",
      publicKeySpkiBase64Url: Buffer.from("not an Ed25519 key").toString("base64url")
    })).toThrow(/public key/i);
    expect(() => validateOperatorPublicKeyConfiguration({
      audience: `${audience}/`,
      keyId: "beta-operator-1",
      publicKeySpkiBase64Url: key.publicKey
    })).toThrow(/audience/i);
  });
});
