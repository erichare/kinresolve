import { createHash } from "node:crypto";

export const databaseIdentityPattern = /^[a-f0-9]{64}$/;
export const supabaseProjectRefPattern = /^[a-z0-9]{20}$/;
export const databaseIdentityQuery = `SELECT
  control.system_identifier::text AS system_identifier,
  database.oid::text AS database_oid,
  current_database()::text AS database_name
FROM pg_control_system() AS control
JOIN pg_database AS database ON database.datname = current_database()`;

export type DatabaseIdentity = {
  fingerprint: string;
};

export type DatabaseIdentityPool = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export function computeDatabaseIdentity(value: {
  systemIdentifier: string;
  databaseOid: string;
  databaseName: string;
}): DatabaseIdentity {
  if (!/^\d{1,20}$/.test(value.systemIdentifier)) {
    throw new Error("Database identity system identifier is invalid.");
  }
  if (!/^\d{1,10}$/.test(value.databaseOid)) {
    throw new Error("Database identity OID is invalid.");
  }
  if (
    !value.databaseName
    || value.databaseName.length > 63
    || /[\0\r\n]/u.test(value.databaseName)
  ) {
    throw new Error("Database identity name is invalid.");
  }

  const fingerprint = createHash("sha256")
    .update("kinresolve-database-identity-v1\0", "utf8")
    .update(value.systemIdentifier, "utf8")
    .update("\0", "utf8")
    .update(value.databaseOid, "utf8")
    .update("\0", "utf8")
    .update(value.databaseName, "utf8")
    .digest("hex");
  return { fingerprint };
}

export async function readDatabaseIdentity(pool: DatabaseIdentityPool): Promise<DatabaseIdentity> {
  const result = await pool.query(databaseIdentityQuery);
  if (result.rows.length !== 1) {
    throw new Error("Database identity query must return exactly one row.");
  }
  const row = result.rows[0];
  return computeDatabaseIdentity({
    systemIdentifier: typeof row.system_identifier === "string" ? row.system_identifier : "",
    databaseOid: typeof row.database_oid === "string" ? row.database_oid : "",
    databaseName: typeof row.database_name === "string" ? row.database_name : ""
  });
}

export function validateConfiguredDatabaseIdentity(
  configuredIdentity: string | undefined,
  actualIdentity: DatabaseIdentity
): DatabaseIdentity {
  if (!configuredIdentity || !databaseIdentityPattern.test(configuredIdentity)) {
    throw new Error("KINRESOLVE_DATABASE_IDENTITY must be a lowercase SHA-256 database fingerprint.");
  }
  if (actualIdentity.fingerprint !== configuredIdentity) {
    throw new Error("The connected database does not match KINRESOLVE_DATABASE_IDENTITY.");
  }
  return actualIdentity;
}

export function assertSupabaseDatabaseProjectBinding(
  databaseUrl: string,
  expectedProjectRef: string
): void {
  if (!supabaseProjectRefPattern.test(expectedProjectRef)) {
    throw new Error("The declared Supabase project ref is invalid.");
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("The recovery database connection is invalid.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("The recovery database connection is invalid.");
  }

  let username: string;
  try {
    username = decodeURIComponent(parsed.username);
  } catch {
    throw new Error("The recovery database connection is invalid.");
  }
  const direct = parsed.hostname === `db.${expectedProjectRef}.supabase.co`;
  const pooler = parsed.hostname.endsWith(".pooler.supabase.com")
    && username.endsWith(`.${expectedProjectRef}`);
  if (!direct && !pooler) {
    throw new Error("The recovery database connection does not address the declared Supabase project.");
  }
}
