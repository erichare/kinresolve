import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  operatorInvitationCommandSchema,
  type OperatorInvitationCommand
} from "./operator-api-schemas.ts";
import {
  operatorSignatureHeaders,
  signOperatorRequest,
  validateOperatorAudience
} from "./operator-signature.ts";

export const BETA_OPERATOR_PATHNAME = "/api/operator/invitations";

const defaultTimeoutMs = 20_000;
const maximumTimeoutMs = 30_000;
const maximumResponseBytes = 64 * 1024;
const keyIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const encodedPrivateKeyPattern = /^[A-Za-z0-9_-]{40,256}$/;
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BetaOperatorConfig = Readonly<{
  audience: string;
  baseUrl: string;
  keyId: string;
  privateKeyPkcs8Base64Url: string;
}>;

export type BetaOperatorClientErrorCode =
  | "CONFIG_INVALID"
  | "HTTP_ERROR"
  | "NETWORK_ERROR"
  | "RESPONSE_INVALID"
  | "TIMEOUT"
  | "USAGE";

export class BetaOperatorClientError extends Error {
  readonly code: BetaOperatorClientErrorCode;
  readonly requestId?: string;
  readonly status?: number;

  constructor(
    code: BetaOperatorClientErrorCode,
    options: { requestId?: string; status?: number } = {}
  ) {
    super(errorMessage(code));
    this.name = "BetaOperatorClientError";
    this.code = code;
    if (options.requestId !== undefined) this.requestId = options.requestId;
    if (options.status !== undefined) this.status = options.status;
  }
}

type BetaOperatorSuccess =
  | Readonly<{
    action: "issue";
    expiresAt: string;
    invitationId: string;
    purpose: "initial-owner" | "member";
    role: "owner" | "admin" | "editor" | "contributor" | "viewer";
  }>
  | Readonly<{ action: "revoke"; revoked: boolean }>
  | Readonly<{ action: "revoke-all"; revokedCount: number }>
  | Readonly<{ action: "application-delete"; deletedCount: number }>
  | Readonly<{ action: "control"; generation: number; state: "active" | "paused" }>
  | Readonly<{
    action: "cleanup";
    expiredApplications: number;
    expiredApiRateLimits: number;
    expiredInvitations: number;
    expiredRateLimits: number;
    expiredVerificationTokens: number;
    removedOperatorNonces: number;
  }>;

type ClientDependencies = Readonly<{
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}>;

const roleSchema = z.enum(["owner", "admin", "editor", "contributor", "viewer"]);
const purposeSchema = z.enum(["initial-owner", "member"]);
const safeCountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const issueResponseSchema = z.object({
  archiveId: z.string().min(1).max(256),
  expiresAt: z.string().datetime({ offset: true }),
  invitationId: z.string().uuid(),
  purpose: purposeSchema,
  role: roleSchema
});
const revokeResponseSchema = z.object({ revoked: z.boolean() });
const revokeAllResponseSchema = z.object({ revokedCount: safeCountSchema });
const applicationDeleteResponseSchema = z.object({ deletedCount: safeCountSchema });
const controlResponseSchema = z.object({
  generation: safeCountSchema,
  state: z.enum(["active", "paused"])
});
const cleanupResponseSchema = z.object({
  expiredApplications: safeCountSchema,
  expiredApiRateLimits: safeCountSchema,
  expiredInvitations: safeCountSchema,
  expiredRateLimits: safeCountSchema,
  expiredVerificationTokens: safeCountSchema,
  removedOperatorNonces: safeCountSchema
});

export function parseBetaOperatorCommand(argv: readonly string[]): OperatorInvitationCommand {
  let candidate: unknown;
  switch (argv[0]) {
    case "issue":
      if (argv.length !== 5) throw new BetaOperatorClientError("USAGE");
      candidate = {
        action: "issue",
        email: argv[1],
        expiresInSeconds: canonicalInteger(argv[4]),
        purpose: argv[3],
        role: argv[2]
      };
      break;
    case "revoke":
      if (argv.length !== 2) throw new BetaOperatorClientError("USAGE");
      candidate = { action: "revoke", invitationId: argv[1] };
      break;
    case "revoke-all":
      if (argv.length !== 1) throw new BetaOperatorClientError("USAGE");
      candidate = { action: "revoke-all" };
      break;
    case "application-delete":
      if (argv.length !== 2) throw new BetaOperatorClientError("USAGE");
      candidate = { action: "application-delete", email: argv[1] };
      break;
    case "control":
      if (argv.length !== 3) throw new BetaOperatorClientError("USAGE");
      candidate = { action: "control", reasonCode: argv[2], state: argv[1] };
      break;
    case "cleanup":
      if (argv.length !== 1 && argv.length !== 2) throw new BetaOperatorClientError("USAGE");
      if (argv[1] !== undefined && canonicalInteger(argv[1]) === undefined) {
        throw new BetaOperatorClientError("USAGE");
      }
      candidate = {
        action: "cleanup",
        ...(argv[1] === undefined ? {} : { limit: canonicalInteger(argv[1]) })
      };
      break;
    default:
      throw new BetaOperatorClientError("USAGE");
  }

  const parsed = operatorInvitationCommandSchema.safeParse(candidate);
  if (!parsed.success) throw new BetaOperatorClientError("USAGE");
  if (
    (parsed.data.action === "issue" || parsed.data.action === "application-delete")
    && parsed.data.email !== argv[1]
  ) {
    throw new BetaOperatorClientError("USAGE");
  }
  return parsed.data;
}

export function readBetaOperatorConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env
): BetaOperatorConfig {
  return validatedConfig({
    audience: environment.KINRESOLVE_BETA_OPERATOR_AUDIENCE ?? "",
    baseUrl: environment.KINRESOLVE_BETA_OPERATOR_BASE_URL ?? "",
    keyId: environment.KINRESOLVE_BETA_OPERATOR_KEY_ID ?? "",
    privateKeyPkcs8Base64Url: environment.KINRESOLVE_BETA_OPERATOR_PRIVATE_KEY_PKCS8 ?? ""
  });
}

export async function executeBetaOperatorCommand(
  command: OperatorInvitationCommand,
  config: BetaOperatorConfig,
  dependencies: ClientDependencies = {}
): Promise<BetaOperatorSuccess> {
  const safeConfig = validatedConfig(config);
  const parsedCommand = operatorInvitationCommandSchema.safeParse(command);
  if (!parsedCommand.success) throw new BetaOperatorClientError("USAGE");
  const safeCommand = parsedCommand.data;
  const timeoutMs = dependencies.timeoutMs ?? defaultTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > maximumTimeoutMs) {
    throw new BetaOperatorClientError("CONFIG_INVALID");
  }

  const endpoint = `${safeConfig.baseUrl}${BETA_OPERATOR_PATHNAME}`;
  const body = JSON.stringify(safeCommand);
  const timestamp = String(Math.floor((dependencies.now?.() ?? new Date()).getTime() / 1000));
  let signature: ReturnType<typeof signOperatorRequest>;
  try {
    signature = signOperatorRequest({
      audience: safeConfig.audience,
      body,
      keyId: safeConfig.keyId,
      method: "POST",
      nonce: randomUUID(),
      pathname: BETA_OPERATOR_PATHNAME,
      privateKeyPkcs8Base64Url: safeConfig.privateKeyPkcs8Base64Url,
      timestamp
    });
  } catch {
    throw new BetaOperatorClientError("CONFIG_INVALID");
  }

  const controller = new AbortController();
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error("operator request timeout"));
    }, timeoutMs);
  });

  try {
    let response: Response;
    try {
      response = await Promise.race([
        fetchImpl(endpoint, {
          body,
          cache: "no-store",
          credentials: "omit",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            [operatorSignatureHeaders.audience]: signature.audience,
            [operatorSignatureHeaders.keyId]: signature.keyId,
            [operatorSignatureHeaders.nonce]: signature.nonce,
            [operatorSignatureHeaders.signature]: signature.signature,
            [operatorSignatureHeaders.timestamp]: signature.timestamp
          },
          method: "POST",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: controller.signal
        }),
        timeoutPromise
      ]);
    } catch {
      throw new BetaOperatorClientError(timedOut ? "TIMEOUT" : "NETWORK_ERROR");
    }

    const responseRequestId = safeRequestId(response.headers.get("x-request-id"));
    if (!response.ok) {
      throw new BetaOperatorClientError("HTTP_ERROR", {
        ...(responseRequestId === undefined ? {} : { requestId: responseRequestId }),
        status: safeHttpStatus(response.status)
      });
    }
    if (response.redirected || response.url !== endpoint) {
      throw new BetaOperatorClientError("RESPONSE_INVALID", {
        ...(responseRequestId === undefined ? {} : { requestId: responseRequestId })
      });
    }

    let responseBody: unknown;
    try {
      responseBody = await Promise.race([
        readJsonResponse(response, responseRequestId),
        timeoutPromise
      ]);
    } catch (error) {
      if (timedOut) throw new BetaOperatorClientError("TIMEOUT");
      throw error;
    }
    try {
      const result = allowlistedSuccess(safeCommand, responseBody);
      if (timedOut) throw new BetaOperatorClientError("TIMEOUT");
      return result;
    } catch (error) {
      if (error instanceof BetaOperatorClientError) throw error;
      throw new BetaOperatorClientError("RESPONSE_INVALID", {
        ...(responseRequestId === undefined ? {} : { requestId: responseRequestId })
      });
    }
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    controller.abort();
  }
}

export function formatBetaOperatorSuccess(result: BetaOperatorSuccess): string {
  return JSON.stringify(result);
}

export function formatBetaOperatorError(error: unknown): string {
  if (!(error instanceof BetaOperatorClientError)) {
    return "Beta operator request failed (UNEXPECTED_ERROR).";
  }
  const details: string[] = [error.code];
  if (error.status !== undefined) details.push(`status=${error.status}`);
  if (error.requestId !== undefined) details.push(`requestId=${error.requestId}`);
  return `Beta operator request failed (${details.join("; ")}).`;
}

function canonicalInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function validatedConfig(config: BetaOperatorConfig): BetaOperatorConfig {
  try {
    validateOperatorAudience(config.audience);
    validateOperatorAudience(config.baseUrl);
    if (config.audience !== config.baseUrl) throw new Error("audience mismatch");
    if (!keyIdPattern.test(config.keyId)) throw new Error("invalid key ID");
    if (!encodedPrivateKeyPattern.test(config.privateKeyPkcs8Base64Url)) throw new Error("invalid private key");
  } catch {
    throw new BetaOperatorClientError("CONFIG_INVALID");
  }
  return { ...config };
}

function errorMessage(code: BetaOperatorClientErrorCode): string {
  switch (code) {
    case "CONFIG_INVALID":
      return "The beta operator client configuration is invalid.";
    case "HTTP_ERROR":
      return "The beta operator endpoint rejected the request.";
    case "NETWORK_ERROR":
      return "The beta operator endpoint could not be reached.";
    case "RESPONSE_INVALID":
      return "The beta operator endpoint returned an invalid response.";
    case "TIMEOUT":
      return "The beta operator request timed out.";
    case "USAGE":
      return "The beta operator command is invalid.";
  }
}

function safeHttpStatus(status: number): number {
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : 500;
}

function safeRequestId(value: string | null): string | undefined {
  return value !== null && requestIdPattern.test(value) ? value.toLowerCase() : undefined;
}

async function readJsonResponse(response: Response, requestId: string | undefined): Promise<unknown> {
  const fail = () => new BetaOperatorClientError("RESPONSE_INVALID", {
    ...(requestId === undefined ? {} : { requestId })
  });
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw fail();
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(contentLength) || Number(contentLength) > maximumResponseBytes) {
      throw fail();
    }
  }
  if (response.body === null) throw fail();

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumResponseBytes) {
        await reader.cancel();
        throw fail();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof BetaOperatorClientError) throw error;
    throw fail();
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw fail();
  }
}

function allowlistedSuccess(
  command: OperatorInvitationCommand,
  responseBody: unknown
): BetaOperatorSuccess {
  switch (command.action) {
    case "issue": {
      const parsed = issueResponseSchema.parse(responseBody);
      return {
        action: "issue",
        invitationId: parsed.invitationId,
        expiresAt: parsed.expiresAt,
        purpose: parsed.purpose,
        role: parsed.role
      };
    }
    case "revoke": {
      const parsed = revokeResponseSchema.parse(responseBody);
      return { action: "revoke", revoked: parsed.revoked };
    }
    case "revoke-all": {
      const parsed = revokeAllResponseSchema.parse(responseBody);
      return { action: "revoke-all", revokedCount: parsed.revokedCount };
    }
    case "application-delete": {
      const parsed = applicationDeleteResponseSchema.parse(responseBody);
      return { action: "application-delete", deletedCount: parsed.deletedCount };
    }
    case "control": {
      const parsed = controlResponseSchema.parse(responseBody);
      return { action: "control", generation: parsed.generation, state: parsed.state };
    }
    case "cleanup": {
      const parsed = cleanupResponseSchema.parse(responseBody);
      return {
        action: "cleanup",
        expiredApplications: parsed.expiredApplications,
        expiredApiRateLimits: parsed.expiredApiRateLimits,
        expiredInvitations: parsed.expiredInvitations,
        expiredRateLimits: parsed.expiredRateLimits,
        expiredVerificationTokens: parsed.expiredVerificationTokens,
        removedOperatorNonces: parsed.removedOperatorNonces
      };
    }
  }
}
