export type VercelProtectionResponse = {
  status: string;
  rawHeaders: string;
  expectedRequestUrl: string;
};

const deploymentHostname = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/;
const protectionNonce = /^[a-f0-9]{64}$/;

export function assertVercelProtectionResponse(input: VercelProtectionResponse): void {
  if (input.status === "401" || input.status === "403") return;
  if (input.status !== "302") {
    throw new Error("The generated deployment did not deny unauthenticated access.");
  }

  const expectedRequest = parseExpectedRequest(input.expectedRequestUrl);
  const locations = input.rawHeaders
    .split(/\r?\n/)
    .map((line) => /^location:[ \t]*(.*)$/i.exec(line)?.[1] ?? null)
    .filter((value): value is string => value !== null);
  if (locations.length !== 1 || locations[0].length === 0) {
    throw new Error("The Vercel protection redirect must contain exactly one Location header.");
  }

  let redirect: URL;
  try {
    redirect = new URL(locations[0]);
  } catch {
    throw new Error("The Vercel protection redirect Location is invalid.");
  }
  if (redirect.protocol !== "https:" || redirect.hostname !== "vercel.com"
      || redirect.port !== "" || redirect.username !== "" || redirect.password !== ""
      || redirect.pathname !== "/sso-api" || redirect.hash !== "") {
    throw new Error("The unauthenticated redirect does not target the Vercel SSO protection endpoint.");
  }

  const entries = [...redirect.searchParams.entries()];
  if (entries.length !== 2
      || redirect.searchParams.getAll("url").length !== 1
      || redirect.searchParams.getAll("nonce").length !== 1
      || redirect.searchParams.get("url") !== expectedRequest.href
      || !protectionNonce.test(redirect.searchParams.get("nonce") ?? "")) {
    throw new Error("The Vercel protection redirect is not bound to the exact generated deployment URL.");
  }
}

function parseExpectedRequest(value: string): URL {
  let expected: URL;
  try {
    expected = new URL(value);
  } catch {
    throw new Error("The expected generated deployment URL is invalid.");
  }
  if (expected.protocol !== "https:" || !deploymentHostname.test(expected.hostname)
      || expected.port !== "" || expected.username !== "" || expected.password !== ""
      || expected.search !== "" || expected.hash !== "") {
    throw new Error("The expected request is not an exact Vercel generated deployment URL.");
  }
  return expected;
}
