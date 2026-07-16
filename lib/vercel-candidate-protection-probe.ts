import { candidateProtectionOrigins, type DeploymentOwnershipExpectations } from "./vercel-release-contract.ts";
import { assertVercelProtectionResponse } from "./vercel-protection-response.ts";

type ProbeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type VercelCandidateProtectionProbeInput = DeploymentOwnershipExpectations & {
  fetch?: ProbeFetch;
};

const maximumResponseBytes = 128 * 1024;

export async function probeVercelCandidateProtection(
  deploymentDocument: unknown,
  input: VercelCandidateProtectionProbeInput
): Promise<Readonly<{ protectedOriginCount: number }>> {
  const origins = candidateProtectionOrigins(deploymentDocument, input);
  const fetchImplementation = input.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") throw protectionError();
  for (const origin of origins) {
    await probeOrigin(`${origin}/api/health`, fetchImplementation);
  }
  return Object.freeze({ protectedOriginCount: origins.length });
}

async function probeOrigin(url: string, fetchImplementation: ProbeFetch): Promise<void> {
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(30_000)
    });
  } catch {
    throw protectionError();
  }
  if (response.redirected) throw protectionError();
  const location = response.headers.get("location");
  const rawHeaders = location === null ? "" : `location: ${location}\r\n`;
  try {
    assertVercelProtectionResponse({
      status: String(response.status),
      rawHeaders,
      expectedRequestUrl: url
    });
  } catch {
    throw protectionError();
  }
  const body = await boundedBody(response);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return;
  }
  if (isRecord(value)
      && ("database" in value || "capabilities" in value || "scheduledWrites" in value)) {
    throw protectionError();
  }
}

async function boundedBody(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumResponseBytes) throw protectionError();
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    throw protectionError();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function protectionError(): Error {
  return new Error("Generated candidate Deployment Protection proof failed.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
