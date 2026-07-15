export type RecoveryDatabaseOperation = "dump" | "restore";

export type RecoveryDatabaseCommand = {
  command: "pg_dump" | "pg_restore";
  args: string[];
  env: NodeJS.ProcessEnv;
};

const libpqEnvironmentKeys = [
  "PGAPPNAME",
  "PGCHANNELBINDING",
  "PGCLIENTENCODING",
  "PGCONNECT_TIMEOUT",
  "PGDATABASE",
  "PGGSSENCMODE",
  "PGHOST",
  "PGHOSTADDR",
  "PGKRBSRVNAME",
  "PGOPTIONS",
  "PGPASSFILE",
  "PGPASSWORD",
  "PGPORT",
  "PGREQUIREAUTH",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGSSLCERT",
  "PGSSLCRL",
  "PGSSLCRLDIR",
  "PGSSLKEY",
  "PGSSLMODE",
  "PGSSLROOTCERT",
  "PGTARGETSESSIONATTRS",
  "PGUSER"
] as const;

const queryParameterEnvironment: ReadonlyMap<string, string> = new Map([
  ["channel_binding", "PGCHANNELBINDING"],
  ["client_encoding", "PGCLIENTENCODING"],
  ["connect_timeout", "PGCONNECT_TIMEOUT"],
  ["gssencmode", "PGGSSENCMODE"],
  ["krbsrvname", "PGKRBSRVNAME"],
  ["options", "PGOPTIONS"],
  ["require_auth", "PGREQUIREAUTH"],
  ["sslcert", "PGSSLCERT"],
  ["sslcrl", "PGSSLCRL"],
  ["sslcrldir", "PGSSLCRLDIR"],
  ["sslkey", "PGSSLKEY"],
  ["sslmode", "PGSSLMODE"],
  ["sslrootcert", "PGSSLROOTCERT"],
  ["target_session_attrs", "PGTARGETSESSIONATTRS"]
]);

export function buildRecoveryDatabaseCommand(
  operation: RecoveryDatabaseOperation,
  filePath: string,
  connectionString: string,
  baseEnvironment: NodeJS.ProcessEnv = process.env
): RecoveryDatabaseCommand {
  const parsed = parseConnection(connectionString);
  const databaseName = decodeConnectionPart(parsed.pathname.slice(1));
  if (!/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/u.test(databaseName)) {
    throw new Error("The recovery database name is invalid.");
  }
  const port = parsed.port || "5432";
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("The recovery database port is invalid.");
  }

  const env: NodeJS.ProcessEnv = { ...baseEnvironment };
  for (const key of libpqEnvironmentKeys) delete env[key];
  env.PGHOST = parsed.hostname;
  env.PGPORT = port;
  env.PGUSER = decodeConnectionPart(parsed.username);
  env.PGPASSWORD = decodeConnectionPart(parsed.password);
  env.PGDATABASE = databaseName;
  env.PGAPPNAME = `kinresolve-recovery-${operation}`;

  for (const [key] of parsed.searchParams) {
    if (!queryParameterEnvironment.has(key)) {
      throw new Error("The recovery database connection contains an unsupported parameter.");
    }
    if (parsed.searchParams.getAll(key).length !== 1) {
      throw new Error("The recovery database connection contains a duplicate parameter.");
    }
  }
  for (const [parameter, environmentName] of queryParameterEnvironment) {
    const value = parsed.searchParams.get(parameter);
    if (value !== null) env[environmentName] = value;
  }

  return operation === "dump"
    ? {
        command: "pg_dump",
        args: [
          "--dbname",
          databaseName,
          "--no-password",
          "--format=custom",
          "--no-owner",
          "--file",
          filePath
        ],
        env
      }
    : {
        command: "pg_restore",
        args: [
          "--dbname",
          databaseName,
          "--no-password",
          "--clean",
          "--if-exists",
          "--no-owner",
          "--exit-on-error",
          filePath
        ],
        env
      };
}

function parseConnection(connectionString: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("The recovery database connection is invalid.");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol)
    || !parsed.hostname
    || !parsed.username
    || parsed.hash
    || !parsed.pathname.startsWith("/")
  ) {
    throw new Error("The recovery database connection is invalid.");
  }
  return parsed;
}

function decodeConnectionPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("The recovery database connection is invalid.");
  }
}
