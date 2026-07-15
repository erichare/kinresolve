import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  BETA_OPERATOR_PATHNAME,
  BetaOperatorClientError,
  executeBetaOperatorCommand,
  formatBetaOperatorError,
  formatBetaOperatorSuccess,
  parseBetaOperatorCommand,
  readBetaOperatorConfig
} from "@/lib/beta-operator-client";
import {
  operatorSignatureHeaders,
  verifyOperatorRequest
} from "@/lib/operator-signature";

const audience = "https://beta.kinresolve.example";
const endpoint = `${audience}${BETA_OPERATOR_PATHNAME}`;
const now = new Date("2026-07-15T18:30:00.000Z");
const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
type FetchMock = ReturnType<typeof vi.fn> & typeof fetch;

function keys() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    publicKey: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64url")
  };
}

function config(privateKey = keys().privateKey) {
  return readBetaOperatorConfig({
    KINRESOLVE_BETA_OPERATOR_AUDIENCE: audience,
    KINRESOLVE_BETA_OPERATOR_BASE_URL: audience,
    KINRESOLVE_BETA_OPERATOR_KEY_ID: "beta-operator-1",
    KINRESOLVE_BETA_OPERATOR_PRIVATE_KEY_PKCS8: privateKey
  });
}

function jsonResponse(body: unknown, status = 200) {
  const response = new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-request-id": requestId
    },
    status
  });
  Object.defineProperty(response, "url", { value: endpoint });
  return response;
}

function fetchReturning(response: Response) {
  return vi.fn(async () => response) as unknown as FetchMock;
}

describe("beta operator command parsing", () => {
  it.each([
    [
      ["issue", "pilot@example.test", "owner", "initial-owner", "900"],
      {
        action: "issue",
        email: "pilot@example.test",
        expiresInSeconds: 900,
        purpose: "initial-owner",
        role: "owner"
      }
    ],
    [
      ["revoke", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      { action: "revoke", invitationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
    ],
    [["revoke-all"], { action: "revoke-all" }],
    [
      ["application-delete", "pilot@example.test"],
      { action: "application-delete", email: "pilot@example.test" }
    ],
    [["control", "paused", "maintenance"], { action: "control", reasonCode: "maintenance", state: "paused" }],
    [["cleanup"], { action: "cleanup" }],
    [["cleanup", "250"], { action: "cleanup", limit: 250 }]
  ])("constructs the exact API body from %j", (argv, expected) => {
    expect(parseBetaOperatorCommand(argv)).toEqual(expected);
  });

  it.each([
    [],
    ["issue", "private-person@example.test", "owner", "initial-owner"],
    ["issue", "private-person@example.test", "root", "member", "900"],
    ["issue", "private-person@example.test", "viewer", "member", "0900"],
    ["revoke", "not-a-private-id"],
    ["revoke-all", "extra-private-value"],
    ["application-delete", "pilot@例え.test"],
    ["application-delete", " pilot@example.test"],
    ["application-delete"],
    ["control", "active", "unknown-private-reason"],
    ["cleanup", "10000.0"]
  ].map((argv) => [argv]))("rejects malformed arguments without retaining their values: %j", (argv) => {
    let caught: unknown;
    try {
      parseBetaOperatorCommand(argv);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BetaOperatorClientError);
    expect((caught as BetaOperatorClientError).code).toBe("USAGE");
    if (argv.length > 0) expect(formatBetaOperatorError(caught)).not.toContain(argv.join(" "));
    expect(formatBetaOperatorError(caught)).not.toMatch(/private-person|private-value|private-id|private-reason/);
  });
});

describe("beta operator client configuration", () => {
  it("requires an exact canonical HTTPS origin, matching audience, key ID, and private key material", () => {
    const key = keys();
    expect(readBetaOperatorConfig({
      KINRESOLVE_BETA_OPERATOR_AUDIENCE: audience,
      KINRESOLVE_BETA_OPERATOR_BASE_URL: audience,
      KINRESOLVE_BETA_OPERATOR_KEY_ID: "beta-operator-1",
      KINRESOLVE_BETA_OPERATOR_PRIVATE_KEY_PKCS8: key.privateKey
    })).toEqual({
      audience,
      baseUrl: audience,
      keyId: "beta-operator-1",
      privateKeyPkcs8Base64Url: key.privateKey
    });

    for (const environment of [
      {},
      {
        KINRESOLVE_BETA_OPERATOR_AUDIENCE: "http://private-host.example",
        KINRESOLVE_BETA_OPERATOR_BASE_URL: "http://private-host.example",
        KINRESOLVE_BETA_OPERATOR_KEY_ID: "beta-operator-1",
        KINRESOLVE_BETA_OPERATOR_PRIVATE_KEY_PKCS8: key.privateKey
      },
      {
        KINRESOLVE_BETA_OPERATOR_AUDIENCE: `${audience}/`,
        KINRESOLVE_BETA_OPERATOR_BASE_URL: `${audience}/`,
        KINRESOLVE_BETA_OPERATOR_KEY_ID: "beta-operator-1",
        KINRESOLVE_BETA_OPERATOR_PRIVATE_KEY_PKCS8: key.privateKey
      },
      {
        KINRESOLVE_BETA_OPERATOR_AUDIENCE: "https://staging.kinresolve.example",
        KINRESOLVE_BETA_OPERATOR_BASE_URL: audience,
        KINRESOLVE_BETA_OPERATOR_KEY_ID: "beta-operator-1",
        KINRESOLVE_BETA_OPERATOR_PRIVATE_KEY_PKCS8: key.privateKey
      },
      {
        KINRESOLVE_BETA_OPERATOR_AUDIENCE: audience,
        KINRESOLVE_BETA_OPERATOR_BASE_URL: audience,
        KINRESOLVE_BETA_OPERATOR_KEY_ID: "private bad key id",
        KINRESOLVE_BETA_OPERATOR_PRIVATE_KEY_PKCS8: "private-key-material-must-not-print"
      }
    ]) {
      let caught: unknown;
      try {
        readBetaOperatorConfig(environment);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(BetaOperatorClientError);
      expect((caught as BetaOperatorClientError).code).toBe("CONFIG_INVALID");
      expect(formatBetaOperatorError(caught)).not.toMatch(/private-host|private bad key|private-key-material/);
    }
  });
});

describe("signed beta operator HTTP transport", () => {
  it("signs and sends the same exact JSON to the one audience-bound endpoint", async () => {
    const key = keys();
    const fetchImpl = fetchReturning(jsonResponse({ revokedCount: 3 }));
    const command = parseBetaOperatorCommand(["revoke-all"]);

    await executeBetaOperatorCommand(command, config(key.privateKey), {
      fetchImpl,
      now: () => now
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(input).toBe(endpoint);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.body).toBe(JSON.stringify({ action: "revoke-all" }));

    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get(operatorSignatureHeaders.audience)).toBe(audience);
    expect(headers.get(operatorSignatureHeaders.nonce)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(headers.get(operatorSignatureHeaders.timestamp)).toBe(String(now.getTime() / 1000));

    expect(verifyOperatorRequest({
      body: init.body as string,
      expectedAudience: audience,
      expectedKeyId: "beta-operator-1",
      fields: {
        audience: headers.get(operatorSignatureHeaders.audience) ?? "",
        keyId: headers.get(operatorSignatureHeaders.keyId) ?? "",
        nonce: headers.get(operatorSignatureHeaders.nonce) ?? "",
        signature: headers.get(operatorSignatureHeaders.signature) ?? "",
        timestamp: headers.get(operatorSignatureHeaders.timestamp) ?? ""
      },
      method: "POST",
      now,
      pathname: BETA_OPERATOR_PATHNAME,
      publicKeySpkiBase64Url: key.publicKey
    })).toMatchObject({ keyId: "beta-operator-1" });
  });

  it("creates a fresh nonce for every request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ revokedCount: 0 })) as unknown as FetchMock;
    const clientConfig = config();
    await executeBetaOperatorCommand({ action: "revoke-all" }, clientConfig, { fetchImpl });
    await executeBetaOperatorCommand({ action: "revoke-all" }, clientConfig, { fetchImpl });
    const nonces = fetchImpl.mock.calls.map((call: unknown[]) =>
      new Headers((call[1] as RequestInit).headers).get(operatorSignatureHeaders.nonce)
    );
    expect(new Set(nonces).size).toBe(2);
  });

  it("bounds the complete response-body operation, not only response headers", async () => {
    const delayedResponse = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ revokedCount: 0 })));
          controller.close();
        }, 40);
      }
    }), {
      headers: { "content-type": "application/json" },
      status: 200
    });
    Object.defineProperty(delayedResponse, "url", { value: endpoint });

    let caught: unknown;
    try {
      await executeBetaOperatorCommand({ action: "revoke-all" }, config(), {
        fetchImpl: fetchReturning(delayedResponse),
        timeoutMs: 5
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BetaOperatorClientError);
    expect((caught as BetaOperatorClientError).code).toBe("TIMEOUT");
  });

  it.each([
    [
      { action: "issue", email: "pilot@example.test", expiresInSeconds: 900, purpose: "member", role: "viewer" } as const,
      {
        archiveId: "private-archive-name",
        expiresAt: "2026-07-16T18:30:00.000Z",
        invitationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        purpose: "member",
        role: "viewer",
        unexpectedPrivateValue: "must-not-print"
      },
      "{\"action\":\"issue\",\"invitationId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"expiresAt\":\"2026-07-16T18:30:00.000Z\",\"purpose\":\"member\",\"role\":\"viewer\"}"
    ],
    [
      { action: "revoke", invitationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } as const,
      { revoked: true, unexpectedPrivateValue: "must-not-print" },
      "{\"action\":\"revoke\",\"revoked\":true}"
    ],
    [
      { action: "revoke-all" } as const,
      { revokedCount: 12, unexpectedPrivateValue: "must-not-print" },
      "{\"action\":\"revoke-all\",\"revokedCount\":12}"
    ],
    [
      { action: "application-delete", email: "pilot@example.test" } as const,
      { deletedCount: 2, unexpectedPrivateValue: "must-not-print" },
      "{\"action\":\"application-delete\",\"deletedCount\":2}"
    ],
    [
      { action: "control", reasonCode: "maintenance", state: "paused" } as const,
      { generation: 4, state: "paused", unexpectedPrivateValue: "must-not-print" },
      "{\"action\":\"control\",\"generation\":4,\"state\":\"paused\"}"
    ],
    [
      { action: "cleanup", limit: 50 } as const,
      {
        expiredApplications: 6,
        expiredApiRateLimits: 5,
        expiredInvitations: 1,
        expiredRateLimits: 2,
        expiredVerificationTokens: 3,
        removedOperatorNonces: 4,
        unexpectedPrivateValue: "must-not-print"
      },
      "{\"action\":\"cleanup\",\"expiredApplications\":6,\"expiredApiRateLimits\":5,\"expiredInvitations\":1,\"expiredRateLimits\":2,\"expiredVerificationTokens\":3,\"removedOperatorNonces\":4}"
    ]
  ])("allowlists only expected %s success fields", async (command, body, expected) => {
    const result = await executeBetaOperatorCommand(command, config(), {
      fetchImpl: fetchReturning(jsonResponse(body))
    });
    const output = formatBetaOperatorSuccess(result);
    expect(output).toBe(expected);
    expect(output).not.toContain("must-not-print");
    expect(output).not.toContain("private-archive-name");
    expect(output).not.toContain("pilot@example.test");
  });

  it("does not read or expose an HTTP error body", async () => {
    let bodyAccessed = false;
    const response = {
      headers: new Headers({ "x-request-id": requestId }),
      ok: false,
      redirected: false,
      status: 409,
      url: endpoint,
      get body() {
        bodyAccessed = true;
        throw new Error("private response body must not be read");
      }
    } as unknown as Response;

    let caught: unknown;
    try {
      await executeBetaOperatorCommand({ action: "revoke-all" }, config(), {
        fetchImpl: fetchReturning(response)
      });
    } catch (error) {
      caught = error;
    }
    expect(bodyAccessed).toBe(false);
    expect(formatBetaOperatorError(caught)).toBe(
      `Beta operator request failed (HTTP_ERROR; status=409; requestId=${requestId}).`
    );
  });

  it("redacts network, timeout, redirect, and malformed-success details", async () => {
    const privateMarker = "private-network-or-response-marker";
    const redirectedResponse = jsonResponse({ revokedCount: 1 });
    Object.defineProperty(redirectedResponse, "redirected", { value: true });
    const malformedResponse = new Response(privateMarker, {
      headers: { "content-type": "application/json" },
      status: 200
    });
    Object.defineProperty(malformedResponse, "url", { value: endpoint });
    const cases: Array<() => Promise<unknown>> = [
      () => executeBetaOperatorCommand({ action: "revoke-all" }, config(), {
        fetchImpl: vi.fn(async () => {
          throw new Error(privateMarker);
        }) as unknown as typeof fetch
      }),
      () => executeBetaOperatorCommand({ action: "revoke-all" }, config(), {
        fetchImpl: vi.fn((_input, init) => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error(privateMarker)));
        })) as unknown as typeof fetch,
        timeoutMs: 10
      }),
      () => executeBetaOperatorCommand({ action: "revoke-all" }, config(), {
        fetchImpl: fetchReturning(redirectedResponse)
      }),
      () => executeBetaOperatorCommand({ action: "revoke-all" }, config(), {
        fetchImpl: fetchReturning(malformedResponse)
      })
    ];

    for (const operation of cases) {
      let caught: unknown;
      try {
        await operation();
      } catch (error) {
        caught = error;
      }
      const output = formatBetaOperatorError(caught);
      expect(output).toMatch(/^Beta operator request failed \([A-Z_]+/);
      expect(output).not.toContain(privateMarker);
    }
  });
});

describe("beta operator CLI safety contract", () => {
  it("prints a fixed failure without echoing command arguments or environment secrets", () => {
    const privateEmail = "private-pilot@example.test";
    const privateKey = "private-key-material-must-not-print";
    const result = spawnSync(process.execPath, [
      "--experimental-strip-types",
      path.join(process.cwd(), "scripts", "beta-operator.mjs"),
      "issue",
      privateEmail,
      "viewer",
      "member",
      "900"
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        KINRESOLVE_BETA_OPERATOR_AUDIENCE: audience,
        KINRESOLVE_BETA_OPERATOR_BASE_URL: audience,
        KINRESOLVE_BETA_OPERATOR_KEY_ID: "bad private key id",
        KINRESOLVE_BETA_OPERATOR_PRIVATE_KEY_PKCS8: privateKey,
        NODE_ENV: "test",
        PATH: process.env.PATH
      }
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Beta operator request failed (CONFIG_INVALID).");
    expect(`${result.stdout}${result.stderr}`).not.toContain(privateEmail);
    expect(`${result.stdout}${result.stderr}`).not.toContain(privateKey);
    expect(`${result.stdout}${result.stderr}`).not.toContain("bad private key id");
  });

  it("has no direct database/service import and exposes the package command", () => {
    const helper = fs.readFileSync(path.join(process.cwd(), "lib", "beta-operator-client.ts"), "utf8");
    const script = fs.readFileSync(path.join(process.cwd(), "scripts", "beta-operator.mjs"), "utf8");
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(`${helper}\n${script}`).not.toMatch(/from ["'][^"']*(?:\/db|beta-invitations|operator-request)["']/);
    expect(script).not.toMatch(/console\.(?:log|error)\([^)]*(?:error|argv|env)/);
    expect(packageJson.scripts["beta:operator"]).toBe(
      "node --experimental-strip-types scripts/beta-operator.mjs"
    );
  });
});
