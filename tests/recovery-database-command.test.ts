import { describe, expect, it } from "vitest";

import { buildRecoveryDatabaseCommand } from "@/lib/recovery-database-command";

describe("recovery database client command", () => {
  it.each(["dump", "restore"] as const)(
    "routes %s explicitly without placing connection secrets in argv",
    (operation) => {
      const secret = "private recovery password";
      const command = buildRecoveryDatabaseCommand(
        operation,
        "/private/recovery.dump",
        `postgresql://runtime:${encodeURIComponent(secret)}@db.${"a".repeat(20)}.supabase.co:5432/postgres`
          + "?sslmode=verify-full&sslrootcert=%2Fprivate%2Fsupabase.crt",
        {
          ...process.env,
          PATH: "/usr/bin",
          PGHOST: "inherited-host-must-not-win",
          PGSERVICE: "inherited-service-must-not-win"
        }
      );

      expect(command.command).toBe(operation === "dump" ? "pg_dump" : "pg_restore");
      expect(command.args.slice(0, 3)).toEqual(["--dbname", "postgres", "--no-password"]);
      expect(command.args.join(" ")).not.toContain(secret);
      expect(command.args.join(" ")).not.toContain("supabase.co");
      expect(command.env).toMatchObject({
        PATH: "/usr/bin",
        PGAPPNAME: `kinresolve-recovery-${operation}`,
        PGDATABASE: "postgres",
        PGHOST: `db.${"a".repeat(20)}.supabase.co`,
        PGPASSWORD: secret,
        PGPORT: "5432",
        PGSSLMODE: "verify-full",
        PGSSLROOTCERT: "/private/supabase.crt",
        PGUSER: "runtime"
      });
      expect(command.env.PGSERVICE).toBeUndefined();
    }
  );

  it("fails closed for unsupported or duplicate connection parameters", () => {
    expect(() => buildRecoveryDatabaseCommand(
      "dump",
      "/private/recovery.dump",
      "postgresql://runtime:secret@localhost:5432/postgres?unknown=value"
    )).toThrow(/unsupported parameter/i);
    expect(() => buildRecoveryDatabaseCommand(
      "restore",
      "/private/recovery.dump",
      "postgresql://runtime:secret@localhost:5432/postgres?sslmode=require&sslmode=verify-full"
    )).toThrow(/duplicate parameter/i);
  });

  it.each([
    "host%3Devil.example%20port%3D1%20dbname%3Dpostgres",
    "postgresql%3A%2F%2Fevil.example%2Fpostgres",
    "postgres%20host%3Devil.example"
  ])("rejects a database path that libpq could reinterpret as connection routing (%s)", (name) => {
    expect(() => buildRecoveryDatabaseCommand(
      "restore",
      "/private/recovery.dump",
      `postgresql://runtime:secret@localhost:5432/${name}`
    )).toThrow(/database name is invalid/i);
  });
});
