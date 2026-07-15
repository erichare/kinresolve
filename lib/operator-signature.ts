import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify
} from "node:crypto";

export const operatorSignatureHeaders = {
  audience: "x-kinresolve-operator-audience",
  keyId: "x-kinresolve-operator-key-id",
  nonce: "x-kinresolve-operator-nonce",
  signature: "x-kinresolve-operator-signature",
  timestamp: "x-kinresolve-operator-timestamp"
} as const;

const keyIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const noncePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const signaturePattern = /^[A-Za-z0-9_-]{86}$/;
const encodedKeyPattern = /^[A-Za-z0-9_-]{40,256}$/;
const timestampPattern = /^[1-9][0-9]{9,12}$/;

export type OperatorSignatureFields = {
  audience: string;
  keyId: string;
  nonce: string;
  signature: string;
  timestamp: string;
};

type OperatorRequestIdentity = {
  body: string;
  method: string;
  pathname: string;
};

type SignOperatorRequestInput = OperatorRequestIdentity & {
  audience: string;
  keyId: string;
  nonce: string;
  privateKeyPkcs8Base64Url: string;
  timestamp: string;
};

type VerifyOperatorRequestInput = OperatorRequestIdentity & {
  expectedAudience: string;
  expectedKeyId: string;
  fields: OperatorSignatureFields;
  maxClockSkewSeconds?: number;
  now?: Date;
  publicKeySpkiBase64Url: string;
};

export type VerifiedOperatorRequest = {
  keyId: string;
  nonce: string;
  requestDigest: string;
  timestamp: Date;
};

export function signOperatorRequest(input: SignOperatorRequestInput): OperatorSignatureFields {
  validateOperatorAudience(input.audience);
  validateKeyId(input.keyId, "Operator key ID");
  validateNonce(input.nonce);
  const timestamp = parseTimestamp(input.timestamp);
  validateRequestIdentity(input);
  const privateKey = privateKeyFrom(input.privateKeyPkcs8Base64Url);
  const signature = sign(null, operatorRequestMessage(input), privateKey).toString("base64url");
  if (!signaturePattern.test(signature)) {
    throw new Error("The operator signature could not be encoded safely.");
  }
  return {
    audience: input.audience,
    keyId: input.keyId,
    nonce: input.nonce,
    signature,
    timestamp: String(Math.floor(timestamp.getTime() / 1000))
  };
}

export function verifyOperatorRequest(input: VerifyOperatorRequestInput): VerifiedOperatorRequest {
  validateOperatorAudience(input.expectedAudience);
  validateOperatorAudience(input.fields.audience);
  validateKeyId(input.expectedKeyId, "Expected operator key ID");
  validateKeyId(input.fields.keyId, "Operator key ID");
  validateNonce(input.fields.nonce);
  if (!signaturePattern.test(input.fields.signature)) {
    throw new Error("The operator request signature is invalid.");
  }
  validateRequestIdentity(input);
  const timestamp = parseTimestamp(input.fields.timestamp);
  const now = input.now ?? new Date();
  const maximumSkew = input.maxClockSkewSeconds ?? 300;
  if (!Number.isSafeInteger(maximumSkew) || maximumSkew < 30 || maximumSkew > 900) {
    throw new Error("The operator request clock-skew policy is invalid.");
  }
  if (Math.abs(now.getTime() - timestamp.getTime()) > maximumSkew * 1000) {
    throw new Error("The operator request has expired.");
  }
  if (input.fields.keyId !== input.expectedKeyId) {
    throw new Error("The operator request key is not authorized.");
  }
  if (input.fields.audience !== input.expectedAudience) {
    throw new Error("The operator request audience is not authorized.");
  }

  const publicKey = publicKeyFrom(input.publicKeySpkiBase64Url);
  const valid = verify(
    null,
    operatorRequestMessage({
      audience: input.fields.audience,
      body: input.body,
      method: input.method,
      pathname: input.pathname,
      keyId: input.fields.keyId,
      nonce: input.fields.nonce,
      timestamp: input.fields.timestamp
    }),
    publicKey,
    Buffer.from(input.fields.signature, "base64url")
  );
  if (!valid) {
    throw new Error("The operator request signature is invalid.");
  }
  return {
    keyId: input.fields.keyId,
    nonce: input.fields.nonce,
    requestDigest: bodyDigest(input.body),
    timestamp
  };
}

export function readOperatorSignatureHeaders(headers: Headers): OperatorSignatureFields {
  return {
    audience: headers.get(operatorSignatureHeaders.audience) ?? "",
    keyId: headers.get(operatorSignatureHeaders.keyId) ?? "",
    nonce: headers.get(operatorSignatureHeaders.nonce) ?? "",
    signature: headers.get(operatorSignatureHeaders.signature) ?? "",
    timestamp: headers.get(operatorSignatureHeaders.timestamp) ?? ""
  };
}

export function validateOperatorPublicKeyConfiguration(input: {
  audience: string;
  keyId: string;
  publicKeySpkiBase64Url: string;
}): void {
  validateOperatorAudience(input.audience);
  validateKeyId(input.keyId, "Operator key ID");
  publicKeyFrom(input.publicKeySpkiBase64Url);
}

function operatorRequestMessage(input: OperatorRequestIdentity & {
  audience: string;
  keyId: string;
  nonce: string;
  timestamp: string;
}): Buffer {
  return Buffer.from([
    "kinresolve-operator-v1",
    input.audience,
    input.keyId,
    input.timestamp,
    input.nonce,
    input.method.toUpperCase(),
    input.pathname,
    bodyDigest(input.body)
  ].join("\n"), "utf8");
}

export function validateOperatorAudience(value: string): void {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:"
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.search !== ""
      || parsed.hash !== ""
      || value !== parsed.origin
    ) {
      throw new Error("not a canonical HTTPS origin");
    }
  } catch (error) {
    throw new Error("The operator request audience is invalid.", { cause: error });
  }
}

function bodyDigest(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function validateRequestIdentity(input: OperatorRequestIdentity): void {
  if (!/^(?:POST|PUT|PATCH|DELETE)$/.test(input.method.toUpperCase())) {
    throw new Error("The operator request method is invalid.");
  }
  if (!input.pathname.startsWith("/api/operator/") || input.pathname.includes("?") || input.pathname.includes("#")) {
    throw new Error("The operator request path is invalid.");
  }
  if (Buffer.byteLength(input.body, "utf8") > 16 * 1024) {
    throw new Error("The operator request body is too large.");
  }
}

function validateKeyId(value: string, label: string): void {
  if (!keyIdPattern.test(value)) throw new Error(`${label} is invalid.`);
}

function validateNonce(value: string): void {
  if (!noncePattern.test(value)) throw new Error("The operator request nonce is invalid.");
}

function parseTimestamp(value: string): Date {
  if (!timestampPattern.test(value)) throw new Error("The operator request timestamp is invalid.");
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds)) throw new Error("The operator request timestamp is invalid.");
  const timestamp = new Date(seconds * 1000);
  if (!Number.isFinite(timestamp.getTime())) throw new Error("The operator request timestamp is invalid.");
  return timestamp;
}

function privateKeyFrom(value: string) {
  validateEncodedKey(value, "operator private key");
  try {
    const key = createPrivateKey({ key: Buffer.from(value, "base64url"), format: "der", type: "pkcs8" });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    return key;
  } catch (error) {
    throw new Error("The operator private key is invalid.", { cause: error });
  }
}

function publicKeyFrom(value: string) {
  validateEncodedKey(value, "operator public key");
  try {
    const key = createPublicKey({ key: Buffer.from(value, "base64url"), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    return key;
  } catch (error) {
    throw new Error("The operator public key is invalid.", { cause: error });
  }
}

function validateEncodedKey(value: string, label: string): void {
  if (!encodedKeyPattern.test(value)) throw new Error(`The ${label} is invalid.`);
}
