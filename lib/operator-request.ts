import type { NextRequest } from "next/server";

import {
  readOperatorSignatureHeaders,
  verifyOperatorRequest,
  type VerifiedOperatorRequest
} from "./operator-signature";

const maximumBodyBytes = 16 * 1024;

export class OperatorRequestError extends Error {
  constructor(
    readonly code: "INVALID_REQUEST" | "MISCONFIGURED",
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "OperatorRequestError";
  }
}

export type AuthenticatedOperatorRequest = {
  body: string;
  claim: VerifiedOperatorRequest;
};

export async function authenticateOperatorRequest(
  request: NextRequest
): Promise<AuthenticatedOperatorRequest> {
  const body = await readBoundedUtf8Body(request);
  const expectedAudience = process.env.KINRESOLVE_BETA_OPERATOR_AUDIENCE?.trim() ?? "";
  const expectedKeyId = process.env.KINRESOLVE_BETA_OPERATOR_KEY_ID?.trim() ?? "";
  const publicKeySpkiBase64Url = process.env.KINRESOLVE_BETA_OPERATOR_PUBLIC_KEY_SPKI?.trim() ?? "";
  if (!expectedAudience || !expectedKeyId || !publicKeySpkiBase64Url) {
    throw new OperatorRequestError("MISCONFIGURED", "Beta operator authentication is not configured.");
  }

  try {
    if (request.nextUrl.origin !== expectedAudience) {
      throw new Error("The request origin does not match the operator audience.");
    }
    const fields = readOperatorSignatureHeaders(request.headers);
    return {
      body,
      claim: verifyOperatorRequest({
        body,
        expectedAudience,
        expectedKeyId,
        fields,
        method: request.method,
        pathname: request.nextUrl.pathname,
        publicKeySpkiBase64Url
      })
    };
  } catch (error) {
    throw new OperatorRequestError("INVALID_REQUEST", "The operator request is not authorized.", {
      cause: error
    });
  }
}

async function readBoundedUtf8Body(request: Request): Promise<string> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maximumBodyBytes) {
      throw new OperatorRequestError("INVALID_REQUEST", "The operator request body is invalid.");
    }
  }

  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBodyBytes) {
        await reader.cancel();
        throw new OperatorRequestError("INVALID_REQUEST", "The operator request body is invalid.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof OperatorRequestError) throw error;
    throw new OperatorRequestError("INVALID_REQUEST", "The operator request body is invalid.", {
      cause: error
    });
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new OperatorRequestError("INVALID_REQUEST", "The operator request body is invalid.", {
      cause: error
    });
  }
}
