type JsonObject = Record<string, unknown>;

export type VercelProjectSafetyExpectations = {
  expectedProjectId: string;
  expectedOrgId: string;
  expectedPaused?: boolean;
};

export type ValidatedVercelProjectSafety = {
  projectId: string;
  orgId: string;
  autoAssignCustomDomains: false;
  paused: boolean;
};

export function validateVercelProjectSafety(
  value: unknown,
  expectations: VercelProjectSafetyExpectations
): ValidatedVercelProjectSafety {
  if (!isObject(value)) throw new Error("The Vercel project response must be a JSON object.");
  const expectedProjectId = identifier(expectations.expectedProjectId, "expected project ID");
  const expectedOrgId = identifier(expectations.expectedOrgId, "expected organization ID");
  const projectId = consistentString(value, ["id"], "project ID");
  if (projectId !== expectedProjectId) {
    throw new Error("The Vercel project response does not match the protected project.");
  }
  const orgId = consistentString(value, ["accountId", "teamId"], "organization ID");
  if (orgId !== expectedOrgId) {
    throw new Error("The Vercel project response does not match the protected organization.");
  }
  if (value.autoAssignCustomDomains !== false) {
    throw new Error("Vercel production domain auto-assignment must be disabled.");
  }
  const paused = value.paused === undefined ? false : value.paused;
  if (typeof paused !== "boolean") {
    throw new Error("The Vercel project paused state is malformed.");
  }
  if (expectations.expectedPaused !== undefined && paused !== expectations.expectedPaused) {
    throw new Error("The Vercel project paused state does not match the required release state.");
  }
  return {
    projectId,
    orgId,
    autoAssignCustomDomains: false,
    paused
  };
}

function identifier(value: string, label: string): string {
  if (!/^[A-Za-z0-9_]{4,128}$/.test(value)) throw new Error(`The ${label} is malformed.`);
  return value;
}

function consistentString(value: JsonObject, keys: readonly string[], label: string): string {
  const values = keys.flatMap((key) => value[key] === undefined ? [] : [value[key]]);
  if (values.length === 0 || values.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`The Vercel project ${label} is missing or malformed.`);
  }
  if (new Set(values).size !== 1) {
    throw new Error(`The Vercel project response contains an ambiguous ${label}.`);
  }
  return values[0] as string;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
