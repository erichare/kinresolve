#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

type ProbeMode = "auth" | "seed" | "rewrite";

type LegacyWorkspace = {
  people: Array<{ id: string }>;
  sources: Array<{ id: string; title: string }>;
};

type LegacyWorkspaceModule = {
  readWorkspace(options: { databaseUrl: string; archiveId: string }): Promise<LegacyWorkspace>;
  writeWorkspace(
    workspace: LegacyWorkspace,
    options: { databaseUrl: string; archiveId: string }
  ): Promise<LegacyWorkspace>;
};

type LegacyDatabaseModule = {
  closeDatabasePools(): Promise<void>;
};

type LegacySessionModule = {
  sessionCookieName: string;
  createSessionToken(secret: string, issuedAt?: number): Promise<string>;
  verifySessionToken(token: string | undefined, secret: string, now?: number): Promise<boolean>;
};

type LegacyLoginModule = {
  POST(request: Request): Promise<Response>;
};

const allowedHosts = new Set(["localhost", "127.0.0.1", "[::1]", "postgres", "release-postgres"]);
const forbiddenRoutingParameters = new Set(["host", "hostaddr", "port", "database", "dbname", "user", "password", "service"]);
const expectedLegacyVersion = "0.17.4";
const fixedAuthSecret = "hermetic-v0.17.4-compatibility-probe-only";
const fixedSharedPassword = "hermetic-v0.17.4-shared-password-only";

function fail(message: string): never {
  throw new Error(message);
}

function assertScratchDatabase(databaseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail("Compatibility probe requires a valid PostgreSQL scratch URL.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !allowedHosts.has(parsed.hostname)) {
    fail("Compatibility probe refuses non-local PostgreSQL hosts.");
  }
  for (const parameter of parsed.searchParams.keys()) {
    if (forbiddenRoutingParameters.has(parameter.toLowerCase())) {
      fail("Compatibility probe refuses connection parameters that can override scratch database routing.");
    }
  }
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    fail("Compatibility probe requires a valid scratch database name.");
  }
  if (!/^kr_compat_[a-z0-9_]+$/.test(databaseName)) {
    fail("Compatibility probe refuses databases outside its tracked scratch namespace.");
  }
}

function taggedModuleUrl(legacyRoot: string, relativePath: string): string {
  return pathToFileURL(path.join(legacyRoot, relativePath)).href;
}

async function legacyVersion(legacyRoot: string): Promise<string> {
  const packageJson = JSON.parse(await readFile(path.join(legacyRoot, "package.json"), "utf8")) as unknown;
  if (typeof packageJson !== "object" || packageJson === null || !("version" in packageJson)) {
    fail("Archived legacy package metadata is invalid.");
  }
  const version = (packageJson as { version?: unknown }).version;
  if (version !== expectedLegacyVersion) {
    fail(`Compatibility probe requires archived package version ${expectedLegacyVersion}.`);
  }
  return version;
}

function postgresFailure(error: unknown): { code: string | null; constraint: string | null; table: string | null } {
  if (typeof error !== "object" || error === null) {
    return { code: null, constraint: null, table: null };
  }
  const record = error as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : null,
    constraint: typeof record.constraint === "string" ? record.constraint : null,
    table: typeof record.table === "string" ? record.table : null
  };
}

function emit(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main(): Promise<void> {
  const [modeValue, legacyRootValue, databaseUrl, archiveId] = process.argv.slice(2);
  if (!(["auth", "seed", "rewrite"] as const).includes(modeValue as ProbeMode)) {
    fail("Compatibility probe mode must be auth, seed, or rewrite.");
  }
  const mode = modeValue as ProbeMode;
  if (!legacyRootValue || !path.isAbsolute(legacyRootValue)) {
    fail("Compatibility probe requires an absolute archived release path.");
  }
  if (!databaseUrl || !archiveId) {
    fail("Compatibility probe requires a tracked scratch database and archive identifier.");
  }
  assertScratchDatabase(databaseUrl);
  if (process.env.DATABASE_AUTO_MIGRATE !== "false") {
    fail("Compatibility probe requires DATABASE_AUTO_MIGRATE=false; legacy migrations must never run.");
  }

  const version = await legacyVersion(legacyRootValue);

  if (mode === "auth") {
    process.env.AUTH_SECRET = fixedAuthSecret;
    process.env.KINSLEUTH_APP_PASSWORD = fixedSharedPassword;
    const session = await import(taggedModuleUrl(legacyRootValue, "lib/session.ts")) as LegacySessionModule;
    const login = await import(taggedModuleUrl(legacyRootValue, "app/api/auth/login/route.ts")) as LegacyLoginModule;
    const response = await login.POST(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: fixedSharedPassword, next: "/app" })
    }));
    const cookieHeader = response.headers.get("set-cookie") ?? "";
    const cookiePair = cookieHeader.split(";", 1)[0];
    const separator = cookiePair.indexOf("=");
    const cookieName = separator > 0 ? cookiePair.slice(0, separator) : "";
    const token = separator > 0 ? decodeURIComponent(cookiePair.slice(separator + 1)) : "";
    const accepted = response.status === 200 && await session.verifySessionToken(token, fixedAuthSecret);
    const [payload, signature, extra] = token.split(".");
    emit({
      probe: "auth-account-boundary",
      packageVersion: version,
      accepted,
      sharedPasswordAccepted: response.status === 200,
      cookieName,
      expectedCookieName: session.sessionCookieName,
      subjectlessIssuedAtPayload: /^\d+$/.test(payload) && Boolean(signature) && extra === undefined
    });
    return;
  }

  const workspaceModule = await import(
    taggedModuleUrl(legacyRootValue, "lib/workspace-store.ts")
  ) as LegacyWorkspaceModule;
  const databaseModule = await import(taggedModuleUrl(legacyRootValue, "lib/db.ts")) as LegacyDatabaseModule;

  try {
    const workspace = await workspaceModule.readWorkspace({ databaseUrl, archiveId });
    if (mode === "seed") {
      emit({
        probe: "pilot-seed-isolation",
        packageVersion: version,
        peopleCount: workspace.people.length,
        sourceTitles: workspace.sources.map((source) => source.title).sort()
      });
      return;
    }

    try {
      await workspaceModule.writeWorkspace(workspace, { databaseUrl, archiveId });
      emit({ probe: "rewrite", packageVersion: version, completed: true, failure: null });
    } catch (error) {
      emit({
        probe: "rewrite",
        packageVersion: version,
        completed: false,
        failure: postgresFailure(error)
      });
    }
  } finally {
    await databaseModule.closeDatabasePools();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Legacy compatibility probe failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
