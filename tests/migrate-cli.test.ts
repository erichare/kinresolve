import { spawnSync } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { describeMigrationFailure } from "@/lib/migration-failure";

const script = path.join(process.cwd(), "scripts", "migrate.mjs");

function runMigrate(extraEnvironment: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, ["--experimental-strip-types", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      ...extraEnvironment,
      NODE_ENV: "test"
    },
    timeout: 60_000
  });
}

// Binds an ephemeral loopback port and releases it so the migrate CLI can be
// pointed at a port that is known to refuse connections.
async function reserveClosedPort(): Promise<number> {
  const server = net.createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as net.AddressInfo).port);
    });
  });
  server.close();
  await once(server, "close");
  return port;
}

describe("describeMigrationFailure", () => {
  const databaseUrl = "postgres://kinresolve:do-not-print@db.internal:6543/kinresolve";

  it("names the redacted target for a dual-stack refusal whose message is empty", () => {
    const refusedOverIpv6 = Object.assign(new Error("connect ECONNREFUSED ::1:6543"), { code: "ECONNREFUSED" });
    const refusedOverIpv4 = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:6543"), {
      code: "ECONNREFUSED"
    });
    const failure = new AggregateError([refusedOverIpv6, refusedOverIpv4]);
    expect(failure.message).toBe("");

    const described = describeMigrationFailure(failure, databaseUrl);
    expect(described).toContain("Cannot reach DATABASE_URL at db.internal:6543/kinresolve (ECONNREFUSED)");
    expect(described).toContain("docker compose up -d postgres");
    expect(described).not.toContain("do-not-print");
  });

  it("recognizes connection failure codes carried on the error itself", () => {
    const failure = Object.assign(new Error(""), { code: "ENOTFOUND" });
    expect(describeMigrationFailure(failure, databaseUrl)).toContain(
      "Cannot reach DATABASE_URL at db.internal:6543/kinresolve (ENOTFOUND)"
    );
  });

  it("treats a pg pool connection timeout as unreachable", () => {
    const failure = new Error("timeout exceeded when trying to connect");
    expect(describeMigrationFailure(failure, databaseUrl)).toContain(
      "Cannot reach DATABASE_URL at db.internal:6543/kinresolve (connection timeout)"
    );
  });

  it("defaults the port and tolerates URLs without a database path", () => {
    const failure = Object.assign(new Error(""), { code: "ECONNREFUSED" });
    expect(describeMigrationFailure(failure, "postgres://user:pw@localhost/kinresolve")).toContain(
      "localhost:5432/kinresolve"
    );
    expect(describeMigrationFailure(failure, "not a url")).toContain("the database configured in DATABASE_URL");
    expect(describeMigrationFailure(failure)).toContain("the database configured in DATABASE_URL");
  });

  it("explains missing databases and failed authentication", () => {
    expect(describeMigrationFailure(Object.assign(new Error("boom"), { code: "3D000" }), databaseUrl)).toContain(
      "Database missing at db.internal:6543/kinresolve"
    );
    for (const sqlState of ["28P01", "28000"]) {
      const described = describeMigrationFailure(Object.assign(new Error("boom"), { code: sqlState }), databaseUrl);
      expect(described).toContain("Database authentication failed for db.internal:6543/kinresolve");
      expect(described).not.toContain("do-not-print");
    }
  });

  it("passes through ordinary error messages unchanged", () => {
    expect(describeMigrationFailure(new Error('relation "cases" already exists'), databaseUrl)).toBe(
      'relation "cases" already exists'
    );
    expect(describeMigrationFailure("plain failure", databaseUrl)).toBe("plain failure");
  });

  it("never returns an empty description", () => {
    const blankAggregate = new AggregateError([Object.assign(new Error(""), { code: "EUNRECOGNIZED" })]);
    for (const failure of [new Error(""), new Error("   "), blankAggregate]) {
      const described = describeMigrationFailure(failure, databaseUrl);
      expect(described.trim()).not.toBe("");
      expect(described).toContain("without an error message");
    }
  });
});

describe("db:migrate CLI", () => {
  it("requires DATABASE_URL before connecting", () => {
    const result = runMigrate();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL is required");
  });

  it("prints an actionable, credential-free message when the database is unreachable", async () => {
    const port = await reserveClosedPort();
    const result = runMigrate({
      DATABASE_URL: `postgres://kinresolve:do-not-print@localhost:${port}/kinresolve`
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Cannot reach DATABASE_URL at localhost:${port}/kinresolve`);
    expect(result.stderr).toContain("docker compose up -d postgres");
    expect(result.stderr).not.toContain("do-not-print");
  });
});
