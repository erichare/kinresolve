type JsonObject = Record<string, unknown>;

export type VercelProjectDomainExpectations = {
  expectedDomain: string;
  expectedProjectId: string;
};

export type ValidatedVercelProjectDomain = {
  domain: string;
  projectId: string;
  verified: true;
};

export function validateVercelProjectDomain(
  value: unknown,
  expectations: VercelProjectDomainExpectations
): ValidatedVercelProjectDomain {
  if (!isObject(value)) throw contractError();
  const expectedDomain = hostname(expectations.expectedDomain);
  const expectedProjectId = identifier(expectations.expectedProjectId);
  if (
    value.name !== expectedDomain
    || value.apexName !== apexName(expectedDomain)
    || value.projectId !== expectedProjectId
    || value.verified !== true
    || !absent(value.redirect)
    || !absent(value.redirectStatusCode)
    || !absent(value.gitBranch)
    || !absent(value.customEnvironmentId)
    || (value.verification !== undefined
      && (!Array.isArray(value.verification) || value.verification.length !== 0))
    || !optionalTimestamp(value.updatedAt)
    || !optionalTimestamp(value.createdAt)
  ) {
    throw contractError();
  }
  return { domain: expectedDomain, projectId: expectedProjectId, verified: true };
}

function hostname(value: string): string {
  if (
    typeof value !== "string"
    || value.length > 253
    || !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(value)
    || value.includes("..")
    || !value.includes(".")
  ) {
    throw contractError();
  }
  return value;
}

function identifier(value: string): string {
  if (!/^[A-Za-z0-9_]{4,128}$/.test(value)) throw contractError();
  return value;
}

function apexName(value: string): string {
  const labels = value.split(".");
  if (labels.length !== 3 || labels[0] !== "demo") throw contractError();
  return labels.slice(1).join(".");
}

function absent(value: unknown): boolean {
  return value === undefined || value === null;
}

function optionalTimestamp(value: unknown): boolean {
  return value === undefined || (Number.isSafeInteger(value) && Number(value) >= 0);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contractError(): Error {
  return new Error("The Vercel project-domain response does not match the dedicated demo ownership contract.");
}
