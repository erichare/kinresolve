import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";

import { readDatabaseIdentity } from "@/lib/database-attestation";
import { runPendingMigrations } from "@/lib/migrations";
import {
  attestRuntimeDatabaseRole,
  runtimeDatabaseRoleQuery,
  validateRuntimeDatabaseRoleRow
} from "@/lib/runtime-database-role-attestation";

const scratchDirectories: string[] = [];
const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function validRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    role_name: "kinresolve_runtime",
    session_role_name: "kinresolve_runtime",
    database_name: "postgres",
    database_oid: "16384",
    backend_pid: "42001",
    rolsuper: false,
    rolbypassrls: true,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolcanlogin: true,
    pg_write_all_data_membership: false,
    migration_role_membership: false,
    admin_membership: false,
    owns_database: false,
    owns_public_schema: false,
    owns_public_relations: false,
    owns_public_functions: false,
    owns_public_types: false,
    public_schema_create: false,
    release_fence_select: true,
    release_fence_insert: false,
    release_fence_update: false,
    release_fence_delete: false,
    release_fence_truncate: false,
    release_fence_trigger: false,
    release_fence_references: false,
    ...overrides
  };
}

describe("runtime database role attestation", () => {
  it("accepts a bounded login role and records either explicit BYPASSRLS posture", () => {
    expect(validateRuntimeDatabaseRoleRow(validRow(), "kinresolve_migrator")).toEqual({
      roleName: "kinresolve_runtime",
      databaseName: "postgres",
      databaseOid: 16384,
      backendPid: 42001,
      bypassRls: true
    });
    expect(validateRuntimeDatabaseRoleRow(
      validRow({ rolbypassrls: false }),
      "kinresolve_migrator"
    ).bypassRls).toBe(false);
    expect(() => validateRuntimeDatabaseRoleRow(
      validRow({ rolbypassrls: "false" }),
      "kinresolve_migrator"
    )).toThrow(/BYPASSRLS posture/i);
  });

  it.each([
    "rolsuper",
    "rolcreatedb",
    "rolcreaterole",
    "rolreplication",
    "pg_write_all_data_membership",
    "migration_role_membership",
    "admin_membership",
    "owns_database",
    "owns_public_schema",
    "owns_public_relations",
    "owns_public_functions",
    "owns_public_types",
    "public_schema_create",
    "release_fence_insert",
    "release_fence_update",
    "release_fence_delete",
    "release_fence_truncate",
    "release_fence_trigger",
    "release_fence_references"
  ])("rejects prohibited effective posture %s", (field) => {
    expect(() => validateRuntimeDatabaseRoleRow(
      validRow({ [field]: true }),
      "kinresolve_migrator"
    )).toThrow(/prohibited privilege, membership, or ownership path/i);
  });

  it("requires a distinct login role with SELECT-only fence visibility", () => {
    expect(() => validateRuntimeDatabaseRoleRow(
      validRow({ role_name: "kinresolve_migrator", session_role_name: "kinresolve_migrator" }),
      "kinresolve_migrator"
    )).toThrow(/distinct database roles/i);
    expect(() => validateRuntimeDatabaseRoleRow(
      validRow({ rolcanlogin: false }),
      "kinresolve_migrator"
    )).toThrow(/bounded application access/i);
    expect(() => validateRuntimeDatabaseRoleRow(
      validRow({ release_fence_select: false }),
      "kinresolve_migrator"
    )).toThrow(/bounded application access/i);
    expect(() => validateRuntimeDatabaseRoleRow(
      validRow({ session_role_name: "postgres" }),
      "kinresolve_migrator"
    )).toThrow(/more privileged session role/i);
  });

  it("queries every required ownership, membership, and fence ACL dimension", () => {
    for (const evidence of [
      "pg_write_all_data",
      "migration_role_membership",
      "admin_membership",
      "owns_public_schema",
      "owns_public_relations",
      "owns_public_functions",
      "owns_public_types",
      "has_schema_privilege",
      "'INSERT'",
      "'UPDATE'",
      "'DELETE'",
      "'TRUNCATE'",
      "'TRIGGER'",
      "'REFERENCES'"
    ]) {
      expect(runtimeDatabaseRoleQuery).toContain(evidence);
    }
  });

  it("rejects equal credentials and unverified remote transport before connecting", async () => {
    const base = {
      expectedArchiveId: "kinresolve-pilot-01",
      expectedDatabaseIdentity: "a".repeat(64)
    };
    const local = "postgres://runtime:secret@localhost/postgres";
    await expect(attestRuntimeDatabaseRole({
      ...base,
      runtimeDatabaseUrl: local,
      migrationDatabaseUrl: local
    })).rejects.toThrow(/distinct and use verified transport/i);
    await expect(attestRuntimeDatabaseRole({
      ...base,
      runtimeDatabaseUrl: "postgres://runtime:secret@database.example/postgres?sslmode=require",
      migrationDatabaseUrl: "postgres://migrator:secret@database.example/postgres?sslmode=require"
    })).rejects.toThrow(/distinct and use verified transport/i);
  });

  it("keeps pulled dotenv and driver details out of CLI failures", () => {
    const root = mkdtempSync(path.join(tmpdir(), "kinresolve-runtime-role-"));
    scratchDirectories.push(root);
    mkdirSync(path.join(root, ".vercel"), { recursive: true });
    const sentinel = "do-not-print-this-runtime-database-secret";
    writeFileSync(
      path.join(root, ".vercel", ".env.production.local"),
      `DATABASE_URL='${sentinel}\n`,
      "utf8"
    );
    const result = spawnSync(
      process.execPath,
      [
        "--no-warnings",
        "--experimental-strip-types",
        path.join(process.cwd(), "scripts", "attest-runtime-database-role.mjs"),
        path.join(root, "attestation.json")
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          MIGRATION_DATABASE_URL: `postgres://migrator:${sentinel}@localhost/postgres`
        }
      }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Runtime database role attestation failed.\n");
    expect(`${result.stdout}${result.stderr}`).not.toContain(sentinel);
  });
});

describeIfDatabase("runtime database role attestation against PostgreSQL", () => {
  it("proves the documented bounded runtime role on a migrated disposable database", async () => {
    const suffix = `${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const roleName = `kr_runtime_attest_${suffix}`;
    const archiveId = `kr_role_archive_${suffix}`;
    const password = `kr-test-${randomUUID().replaceAll("-", "")}`;
    const quotedRole = quoteIdentifier(roleName);
    const pool = new Pool({ connectionString: databaseUrl!, max: 2 });
    let roleCreated = false;

    try {
      await runPendingMigrations(pool);
      const databaseResult = await pool.query<{ database_name: string }>(
        "SELECT current_database()::text AS database_name"
      );
      const databaseName = databaseResult.rows[0]?.database_name;
      if (!databaseName) throw new Error("The disposable role test database is unavailable.");

      await pool.query(
        `CREATE ROLE ${quotedRole}
         LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT BYPASSRLS
         PASSWORD ${quoteLiteral(password)}`
      );
      roleCreated = true;
      await pool.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${quotedRole}`);
      await pool.query(`GRANT USAGE ON SCHEMA public TO ${quotedRole}`);
      await pool.query(`REVOKE CREATE ON SCHEMA public FROM ${quotedRole}`);
      await pool.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quotedRole}`
      );
      await pool.query(`REVOKE ALL ON TABLE public.release_write_fences FROM ${quotedRole}`);
      await pool.query(`GRANT SELECT ON TABLE public.release_write_fences TO ${quotedRole}`);
      await pool.query(`REVOKE ALL ON TABLE public.schema_migrations FROM ${quotedRole}`);
      await pool.query(`GRANT SELECT ON TABLE public.schema_migrations TO ${quotedRole}`);
      await pool.query(
        `INSERT INTO public.archives (id, name, slug, dataset_mode)
         VALUES ($1, 'Runtime role attestation fixture', $2, 'pilot')`,
        [archiveId, `${archiveId}-slug`]
      );

      const identity = await readDatabaseIdentity(pool);
      const runtimeUrl = new URL(databaseUrl!);
      runtimeUrl.username = roleName;
      runtimeUrl.password = password;
      const attestation = await attestRuntimeDatabaseRole({
        runtimeDatabaseUrl: runtimeUrl.toString(),
        migrationDatabaseUrl: databaseUrl!,
        expectedDatabaseIdentity: identity.fingerprint,
        expectedArchiveId: archiveId
      });

      expect(attestation).toMatchObject({
        databaseIdentity: identity.fingerprint,
        credentialsDistinct: true,
        sameDatabaseSessionVerified: true,
        superuser: false,
        bypassRls: true,
        pgWriteAllDataMembership: false,
        migrationRoleMembership: false,
        adminMembership: false,
        ownsDatabase: false,
        ownsPublicSchema: false,
        ownsPublicRelations: false,
        ownsPublicFunctions: false,
        ownsPublicTypes: false,
        publicSchemaCreate: false,
        releaseFenceSelect: true,
        releaseFenceInsert: false,
        releaseFenceUpdate: false,
        releaseFenceDelete: false,
        representativeAppWriteRolledBack: true,
        persistentMutation: false
      });
      await expect(pool.query(
        "SELECT name FROM public.archives WHERE id = $1",
        [archiveId]
      )).resolves.toMatchObject({ rows: [{ name: "Runtime role attestation fixture" }] });
    } finally {
      await pool.query("DELETE FROM public.archives WHERE id = $1", [archiveId]).catch(() => undefined);
      if (roleCreated) {
        await pool.query(`DROP OWNED BY ${quotedRole}`);
        await pool.query(`DROP ROLE ${quotedRole}`);
      }
      await pool.end();
    }
  });
});

function quoteIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error("Unsafe PostgreSQL test identifier.");
  return `"${value}"`;
}

function quoteLiteral(value: string): string {
  if (!/^[A-Za-z0-9-]{16,128}$/.test(value)) throw new Error("Unsafe PostgreSQL test literal.");
  return `'${value}'`;
}
