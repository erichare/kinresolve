const resendEndpoint = "https://api.resend.com/emails";
const resendDefaultTimeoutMs = 10_000;
const resendMaximumTimeoutMs = 30_000;
const resendMaximumResponseBytes = 16 * 1024;

const transactionalEmailKinds = [
  "invite",
  "verification",
  "password-reset",
  "password-changed",
  "security-notification",
  "application-receipt",
  "application-founder"
] as const;

const transactionalActionPaths = {
  invite: "/invite",
  verification: "/verify-email",
  "password-reset": "/reset-password"
} as const;

const emailAddressPattern = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const resendApiKeyPattern = /^re_[A-Za-z0-9_-]{20,253}$/;
const providerIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const actionTokenPattern = /^[A-Za-z0-9_-]{24,512}$/;
const operationIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const idempotencyKeyPattern = /^kinresolve:(invite|verification|password-reset|password-changed|security-notification|application-receipt|application-founder):[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;

declare const actionUrlBrand: unique symbol;
declare const idempotencyKeyBrand: unique symbol;

export type TransactionalEmailKind = (typeof transactionalEmailKinds)[number];
export type TransactionalActionKind = keyof typeof transactionalActionPaths;
export type TransactionalActionUrl<Kind extends TransactionalActionKind> = string & {
  readonly [actionUrlBrand]: Kind;
};
export type TransactionalEmailIdempotencyKey = string & {
  readonly [idempotencyKeyBrand]: true;
};

export type TransactionalEmailMessage = Readonly<{
  kind: TransactionalEmailKind;
  to: string;
  idempotencyKey: TransactionalEmailIdempotencyKey;
  subject: string;
  text: string;
  html: string;
}>;

export type TransactionalEmailDelivery = Readonly<{
  provider: string;
  messageId: string;
}>;

export interface TransactionalEmailTransport {
  send(message: TransactionalEmailMessage): Promise<TransactionalEmailDelivery>;
}

export type ResendTransactionalEmailConfig = Readonly<{
  provider: "resend";
  appBaseUrl: string;
  apiKey: string;
  from: string;
  replyTo?: string;
}>;

export type TransactionalEmailConfig = ResendTransactionalEmailConfig;
export type TransactionalEmailEnvironment = Record<string, string | undefined>;
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type ResendTransactionalEmailTransportOptions = Readonly<{
  timeoutMs?: number;
}>;

export type TransactionalEmailDeliveryErrorCode =
  | "invalid-message"
  | "provider-unavailable"
  | "provider-rejected"
  | "invalid-provider-response";

const deliveryErrorMessages: Record<TransactionalEmailDeliveryErrorCode, string> = {
  "invalid-message": "The transactional email message is invalid.",
  "provider-unavailable": "The transactional email provider is unavailable.",
  "provider-rejected": "The transactional email provider rejected the request.",
  "invalid-provider-response": "The transactional email provider returned an invalid response."
};

export class TransactionalEmailDeliveryError extends Error {
  readonly code: TransactionalEmailDeliveryErrorCode;
  readonly status?: number;
  readonly providerRequestId?: string;

  constructor(
    code: TransactionalEmailDeliveryErrorCode,
    details: { status?: number; providerRequestId?: string } = {}
  ) {
    super(deliveryErrorMessages[code]);
    this.name = "TransactionalEmailDeliveryError";
    this.code = code;
    this.status = details.status;
    this.providerRequestId = details.providerRequestId;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.providerRequestId === undefined
        ? {}
        : { providerRequestId: this.providerRequestId })
    };
  }
}

export function parseTransactionalEmailConfig(
  environment: TransactionalEmailEnvironment = process.env
): TransactionalEmailConfig {
  const provider = requiredConfigurationValue(
    environment,
    "KINRESOLVE_TRANSACTIONAL_EMAIL_PROVIDER",
    "Transactional email provider configuration is invalid."
  );
  if (provider !== "resend") {
    throw new Error("Transactional email provider configuration is invalid.");
  }

  const appBaseUrl = parseHttpsOrigin(
    requiredConfigurationValue(
      environment,
      "APP_BASE_URL",
      "APP_BASE_URL must be a canonical HTTPS origin."
    )
  );
  const apiKey = requiredConfigurationValue(
    environment,
    "RESEND_API_KEY",
    "Transactional email API key configuration is invalid."
  );
  if (!resendApiKeyPattern.test(apiKey)) {
    throw new Error("Transactional email API key configuration is invalid.");
  }

  const from = requiredConfigurationValue(
    environment,
    "KINRESOLVE_TRANSACTIONAL_EMAIL_FROM",
    "Transactional email sender configuration is invalid."
  );
  if (!isMailbox(from, true)) {
    throw new Error("Transactional email sender configuration is invalid.");
  }

  const configuredReplyTo = environment.KINRESOLVE_TRANSACTIONAL_EMAIL_REPLY_TO;
  if (configuredReplyTo !== undefined && !isMailbox(configuredReplyTo, false)) {
    throw new Error("Transactional email reply-to configuration is invalid.");
  }

  return {
    provider,
    appBaseUrl,
    apiKey,
    from,
    ...(configuredReplyTo === undefined ? {} : { replyTo: configuredReplyTo })
  };
}

export function buildInviteActionUrl(
  appBaseUrl: string,
  token: string
): TransactionalActionUrl<"invite"> {
  return buildActionUrl("invite", appBaseUrl, token);
}

export function buildVerificationActionUrl(
  appBaseUrl: string,
  token: string
): TransactionalActionUrl<"verification"> {
  return buildActionUrl("verification", appBaseUrl, token);
}

export function buildPasswordResetActionUrl(
  appBaseUrl: string,
  token: string
): TransactionalActionUrl<"password-reset"> {
  return buildActionUrl("password-reset", appBaseUrl, token);
}

export function assertTransactionalActionUrl<Kind extends TransactionalActionKind>(
  actionUrl: string,
  expectedKind: Kind
): asserts actionUrl is TransactionalActionUrl<Kind> {
  let parsed: URL;
  try {
    parsed = new URL(actionUrl);
  } catch {
    throw new Error(`${actionKindLabel(expectedKind)} URL is invalid.`);
  }

  const fragment = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : "";
  const fragmentParameters = new URLSearchParams(fragment);
  const token = fragmentParameters.get("token");
  const fragmentKeys = [...fragmentParameters.keys()];
  const expectedPath = transactionalActionPaths[expectedKind];
  if (
    parsed.protocol !== "https:"
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.pathname !== expectedPath
    || parsed.search !== ""
    || fragmentKeys.length !== 1
    || fragmentKeys[0] !== "token"
    || token === null
    || !actionTokenPattern.test(token)
    || parsed.href !== `${parsed.origin}${expectedPath}#token=${encodeURIComponent(token)}`
  ) {
    throw new Error(`${actionKindLabel(expectedKind)} URL is invalid.`);
  }
}

export function createTransactionalEmailIdempotencyKey(
  kind: TransactionalEmailKind,
  operationIdentifier: string
): TransactionalEmailIdempotencyKey {
  if (
    !transactionalEmailKinds.includes(kind)
    || !operationIdentifierPattern.test(operationIdentifier)
  ) {
    throw new Error("Transactional email idempotency input is invalid.");
  }

  return `kinresolve:${kind}:${operationIdentifier}` as TransactionalEmailIdempotencyKey;
}

export function isTransactionalEmailAddress(value: string): boolean {
  return isMailbox(value, false);
}

export class ResendTransactionalEmailTransport implements TransactionalEmailTransport {
  readonly #config: ResendTransactionalEmailConfig;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  constructor(
    config: ResendTransactionalEmailConfig,
    fetchImplementation: FetchLike = globalThis.fetch,
    options: ResendTransactionalEmailTransportOptions = {}
  ) {
    assertResendConfig(config);
    if (typeof fetchImplementation !== "function") {
      throw new Error("Transactional email HTTP transport is unavailable.");
    }
    const timeoutMs = options.timeoutMs ?? resendDefaultTimeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > resendMaximumTimeoutMs) {
      throw new Error("Transactional email HTTP timeout configuration is invalid.");
    }
    this.#config = config;
    this.#fetch = fetchImplementation;
    this.#timeoutMs = timeoutMs;
  }

  async send(message: TransactionalEmailMessage): Promise<TransactionalEmailDelivery> {
    assertTransactionalEmailMessage(message);

    const controller = new AbortController();
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error("transactional email timeout"));
      }, this.#timeoutMs);
    });

    try {
      let response: Response;
      try {
        response = await Promise.race([
          this.#fetch(resendEndpoint, {
            method: "POST",
            redirect: "error",
            cache: "no-store",
            credentials: "omit",
            referrerPolicy: "no-referrer",
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${this.#config.apiKey}`,
              "Content-Type": "application/json",
              "Idempotency-Key": message.idempotencyKey
            },
            body: JSON.stringify({
              from: this.#config.from,
              to: [message.to],
              ...(this.#config.replyTo === undefined ? {} : { reply_to: this.#config.replyTo }),
              subject: message.subject,
              text: message.text,
              html: message.html
            })
          }),
          timeoutPromise
        ]);
      } catch {
        throw new TransactionalEmailDeliveryError("provider-unavailable");
      }

      const status = safeResponseStatus(response);
      const providerRequestId = safeProviderRequestId(response);
      if (!response.ok) {
        throw new TransactionalEmailDeliveryError("provider-rejected", {
          status,
          providerRequestId
        });
      }
      if (response.redirected || (response.url !== "" && response.url !== resendEndpoint)) {
        throw new TransactionalEmailDeliveryError("invalid-provider-response", {
          status,
          providerRequestId
        });
      }

      let payload: unknown;
      try {
        payload = await Promise.race([
          readBoundedJsonResponse(response),
          timeoutPromise
        ]);
      } catch (error) {
        if (timedOut) {
          throw new TransactionalEmailDeliveryError("provider-unavailable");
        }
        if (error instanceof TransactionalEmailDeliveryError) throw error;
        throw new TransactionalEmailDeliveryError("invalid-provider-response", {
          status,
          providerRequestId
        });
      }

      const messageId = providerMessageId(payload);
      if (messageId === null) {
        throw new TransactionalEmailDeliveryError("invalid-provider-response", {
          status,
          providerRequestId
        });
      }

      return { provider: "resend", messageId };
    } catch (error) {
      if (error instanceof TransactionalEmailDeliveryError) throw error;
      if (timedOut) throw new TransactionalEmailDeliveryError("provider-unavailable");
      throw new TransactionalEmailDeliveryError("invalid-provider-response");
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      controller.abort();
    }
  }
}

export function createTransactionalEmailTransport(
  config: TransactionalEmailConfig,
  options: { fetch?: FetchLike; timeoutMs?: number } = {}
): TransactionalEmailTransport {
  return new ResendTransactionalEmailTransport(
    config,
    options.fetch ?? globalThis.fetch,
    options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }
  );
}

function buildActionUrl<Kind extends TransactionalActionKind>(
  kind: Kind,
  appBaseUrl: string,
  token: string
): TransactionalActionUrl<Kind> {
  const origin = parseHttpsOrigin(appBaseUrl);
  if (!actionTokenPattern.test(token)) {
    throw new Error("Transactional action token is invalid.");
  }

  const actionUrl = `${origin}${transactionalActionPaths[kind]}#token=${encodeURIComponent(token)}`;
  return actionUrl as TransactionalActionUrl<Kind>;
}

function parseHttpsOrigin(value: string): string {
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error("APP_BASE_URL must be a canonical HTTPS origin.");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("APP_BASE_URL must be a canonical HTTPS origin.");
  }

  if (
    parsed.protocol !== "https:"
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.pathname !== "/"
    || parsed.search !== ""
    || parsed.hash !== ""
  ) {
    throw new Error("APP_BASE_URL must be a canonical HTTPS origin.");
  }

  return parsed.origin;
}

function requiredConfigurationValue(
  environment: TransactionalEmailEnvironment,
  name: string,
  errorMessage: string
): string {
  const value = environment[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(errorMessage);
  }
  return value;
}

function isMailbox(value: string, allowDisplayName: boolean): boolean {
  if (
    typeof value !== "string"
    || value === ""
    || value.length > 320
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/.test(value)
    || value.includes(",")
  ) {
    return false;
  }

  if (isBareEmailAddress(value)) return true;
  if (!allowDisplayName) return false;

  const displayNameMatch = /^([A-Za-z0-9][A-Za-z0-9 .'-]{0,62}) <([^<>]+)>$/.exec(value);
  return displayNameMatch !== null
    && displayNameMatch[1] === displayNameMatch[1].trim()
    && isBareEmailAddress(displayNameMatch[2]);
}

function isBareEmailAddress(value: string): boolean {
  if (value.length > 254 || !emailAddressPattern.test(value)) return false;
  const [localPart, domain] = value.split("@");
  if (
    localPart.length === 0
    || localPart.length > 64
    || localPart.startsWith(".")
    || localPart.endsWith(".")
    || localPart.includes("..")
    || domain.length === 0
  ) {
    return false;
  }

  return domain.split(".").every((label) => (
    label.length > 0
    && label.length <= 63
    && !label.startsWith("-")
    && !label.endsWith("-")
  ));
}

function assertResendConfig(config: ResendTransactionalEmailConfig): void {
  if (
    config.provider !== "resend"
    || !resendApiKeyPattern.test(config.apiKey)
    || !isMailbox(config.from, true)
    || (config.replyTo !== undefined && !isMailbox(config.replyTo, false))
  ) {
    throw new Error("Transactional email provider configuration is invalid.");
  }
  parseHttpsOrigin(config.appBaseUrl);
}

function assertTransactionalEmailMessage(
  message: TransactionalEmailMessage
): asserts message is TransactionalEmailMessage {
  const idempotencyMatch = idempotencyKeyPattern.exec(message.idempotencyKey);
  const valid = transactionalEmailKinds.includes(message.kind)
    && isMailbox(message.to, false)
    && idempotencyMatch !== null
    && idempotencyMatch[1] === message.kind
    && isSafeSubject(message.subject)
    && isSafeBody(message.text)
    && isSafeBody(message.html);

  if (!valid) {
    throw new TransactionalEmailDeliveryError("invalid-message");
  }
}

function isSafeSubject(value: string): boolean {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 200
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isSafeBody(value: string): boolean {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 100_000
    && !/[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

function safeResponseStatus(response: Response): number | undefined {
  return Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
    ? response.status
    : undefined;
}

function safeProviderRequestId(response: Response): string | undefined {
  let value: string | null;
  try {
    value = response.headers.get("x-request-id") ?? response.headers.get("resend-request-id");
  } catch {
    return undefined;
  }
  return value !== null && providerIdentifierPattern.test(value) ? value : undefined;
}

function providerMessageId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || !("id" in payload)) return null;
  const id = (payload as { id?: unknown }).id;
  return typeof id === "string" && providerIdentifierPattern.test(id) ? id : null;
}

async function readBoundedJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new Error("invalid content type");

  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (
      !/^(?:0|[1-9][0-9]*)$/.test(contentLength)
      || Number(contentLength) > resendMaximumResponseBytes
    ) {
      throw new Error("invalid content length");
    }
  }
  if (response.body === null) throw new Error("missing response body");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > resendMaximumResponseBytes) {
        await reader.cancel();
        throw new Error("response body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

function actionKindLabel(kind: TransactionalActionKind): string {
  if (kind === "password-reset") return "Password reset";
  return kind === "verification" ? "Verification" : "Invite";
}
