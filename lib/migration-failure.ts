// This module is executed directly by scripts/migrate.mjs under Node's type
// stripping, so it must only use erasable TypeScript syntax and must not
// import other project modules.

// Node's dual-stack connect failure is an AggregateError whose own message is
// the empty string and whose cause codes sit in the nested errors array, so a
// plain `console.error(error.message)` prints a blank line.
const connectionFailureCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "EPIPE"
]);

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function findConnectionFailureCode(error: unknown, depth = 0): string | undefined {
  if (depth > 2 || typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = readErrorCode(error);
  if (code && connectionFailureCodes.has(code)) {
    return code;
  }
  const nested = (error as { errors?: unknown }).errors;
  if (Array.isArray(nested)) {
    for (const candidate of nested) {
      const nestedCode = findConnectionFailureCode(candidate, depth + 1);
      if (nestedCode) {
        return nestedCode;
      }
    }
  }
  return undefined;
}

// Names the database target without echoing DATABASE_URL credentials.
function describeDatabaseTarget(databaseUrl: string | undefined): string {
  if (databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);
      const database = parsed.pathname.replace(/^\//, "");
      return `${parsed.hostname}:${parsed.port || "5432"}${database ? `/${database}` : ""}`;
    } catch {
      // Unparseable URLs fall through to the generic description.
    }
  }
  return "the database configured in DATABASE_URL";
}

export function describeMigrationFailure(error: unknown, databaseUrl?: string): string {
  const target = describeDatabaseTarget(databaseUrl);
  const connectionCode = findConnectionFailureCode(error);
  const connectionTimedOut =
    error instanceof Error && error.message.includes("timeout exceeded when trying to connect");
  if (connectionCode || connectionTimedOut) {
    return (
      `Cannot reach DATABASE_URL at ${target} (${connectionCode ?? "connection timeout"}). ` +
      "Start Postgres (docker compose up -d postgres) or fix DATABASE_URL."
    );
  }

  const sqlState = readErrorCode(error);
  if (sqlState === "3D000") {
    return `Database missing at ${target} — create it (or fix DATABASE_URL), then rerun npm run db:migrate.`;
  }
  if (sqlState === "28P01" || sqlState === "28000") {
    return `Database authentication failed for ${target} — check the DATABASE_URL credentials.`;
  }

  const message = error instanceof Error ? error.message.trim() : String(error).trim();
  if (message) {
    return message;
  }
  const name = error instanceof Error ? error.constructor.name : typeof error;
  return `Migration failed without an error message (${name}${sqlState ? ` ${sqlState}` : ""}).`;
}
