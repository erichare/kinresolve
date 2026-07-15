import path from "node:path";

// This module is imported by lib/db.ts at runtime AND executed directly by
// scripts/migrate.mjs under Node's type stripping, so it must only use
// erasable TypeScript syntax and must not import other project modules.

const supabasePoolerHostnameSuffix = ".pooler.supabase.com";
const supabaseDirectHostnamePattern = /^db\.[a-z0-9]{20}\.supabase\.co$/;
const supabaseRootCertificatePath = path.join(process.cwd(), "certs", "supabase-prod-ca-2021.crt");
const databaseUrlSslParameters = ["ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"];

export function getDatabaseConnectionString(databaseUrl: string): string {
  let parsed: URL;

  try {
    parsed = new URL(databaseUrl);
  } catch {
    return databaseUrl;
  }

  const isSupabaseHost = parsed.hostname.endsWith(supabasePoolerHostnameSuffix)
    || supabaseDirectHostnamePattern.test(parsed.hostname);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !isSupabaseHost) {
    return databaseUrl;
  }

  for (const parameter of databaseUrlSslParameters) {
    parsed.searchParams.delete(parameter);
  }
  parsed.searchParams.set("sslmode", "verify-full");
  parsed.searchParams.set("sslrootcert", supabaseRootCertificatePath);

  return parsed.toString();
}

export function isDatabaseTransportVerified(databaseUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(getDatabaseConnectionString(databaseUrl));
  } catch {
    return false;
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) return false;
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (
    hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname === "postgres"
  ) {
    return true;
  }
  return parsed.searchParams.get("sslmode") === "verify-full"
    && Boolean(parsed.searchParams.get("sslrootcert"));
}
