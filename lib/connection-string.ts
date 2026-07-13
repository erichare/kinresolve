import path from "node:path";

// This module is imported by lib/db.ts at runtime AND executed directly by
// scripts/migrate.mjs under Node's type stripping, so it must only use
// erasable TypeScript syntax and must not import other project modules.

const supabasePoolerHostnameSuffix = ".pooler.supabase.com";
const supabaseRootCertificatePath = path.join(process.cwd(), "certs", "supabase-prod-ca-2021.crt");
const databaseUrlSslParameters = ["ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"];

export function getDatabaseConnectionString(databaseUrl: string): string {
  let parsed: URL;

  try {
    parsed = new URL(databaseUrl);
  } catch {
    return databaseUrl;
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname.endsWith(supabasePoolerHostnameSuffix)) {
    return databaseUrl;
  }

  for (const parameter of databaseUrlSslParameters) {
    parsed.searchParams.delete(parameter);
  }
  parsed.searchParams.set("sslmode", "verify-full");
  parsed.searchParams.set("sslrootcert", supabaseRootCertificatePath);

  return parsed.toString();
}
