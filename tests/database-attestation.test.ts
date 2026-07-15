import { describe, expect, it, vi } from "vitest";

import {
  assertSupabaseDatabaseProjectBinding,
  computeDatabaseIdentity,
  databaseIdentityQuery,
  readDatabaseIdentity,
  validateConfiguredDatabaseIdentity
} from "@/lib/database-attestation";

describe("database identity attestation", () => {
  it("derives a stable opaque fingerprint from catalog identity", () => {
    const input = {
      systemIdentifier: "7543210987654321098",
      databaseOid: "16384",
      databaseName: "postgres"
    };
    const first = computeDatabaseIdentity(input);
    const second = computeDatabaseIdentity(input);

    expect(first).toEqual(second);
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(computeDatabaseIdentity({ ...input, databaseOid: "16385" })).not.toEqual(first);
    expect(JSON.stringify(first)).not.toContain(input.systemIdentifier);
  });

  it("binds direct and session-pooler URLs to one exact Supabase project ref", () => {
    const projectRef = "abcdefghijklmnopqrst";
    expect(() => assertSupabaseDatabaseProjectBinding(
      `postgresql://runtime:secret@db.${projectRef}.supabase.co:5432/postgres`,
      projectRef
    )).not.toThrow();
    expect(() => assertSupabaseDatabaseProjectBinding(
      `postgresql://runtime.${projectRef}:secret@aws-0-us-west-1.pooler.supabase.com:5432/postgres`,
      projectRef
    )).not.toThrow();

    for (const [url, declaredRef] of [
      ["postgresql://runtime:secret@db.bcdefghijklmnopqrstu.supabase.co:5432/postgres", projectRef],
      ["postgresql://runtime.bcdefghijklmnopqrstu:secret@aws-0.pooler.supabase.com:5432/postgres", projectRef],
      [`postgresql://runtime.${projectRef}:secret@database.example:5432/postgres`, projectRef],
      [`postgresql://runtime:secret@db.${projectRef}.supabase.co:5432/postgres`, "invalid"]
    ]) {
      expect(() => assertSupabaseDatabaseProjectBinding(url, declaredRef)).toThrow(/project|connection/i);
    }
  });

  it("reads exactly one complete catalog row", async () => {
    const query = vi.fn(async () => ({
      rows: [{
        system_identifier: "7543210987654321098",
        database_oid: "16384",
        database_name: "postgres"
      }]
    }));

    const identity = await readDatabaseIdentity({ query });

    expect(query).toHaveBeenCalledWith(databaseIdentityQuery);
    expect(identity.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails closed for malformed catalog output or a configured mismatch", async () => {
    await expect(readDatabaseIdentity({
      query: async () => ({ rows: [] })
    })).rejects.toThrow(/exactly one row/i);
    expect(() => computeDatabaseIdentity({
      systemIdentifier: "not-an-id",
      databaseOid: "16384",
      databaseName: "postgres"
    })).toThrow(/system identifier/i);

    const actual = computeDatabaseIdentity({
      systemIdentifier: "7543210987654321098",
      databaseOid: "16384",
      databaseName: "postgres"
    });
    expect(validateConfiguredDatabaseIdentity(actual.fingerprint, actual)).toBe(actual);
    expect(() => validateConfiguredDatabaseIdentity("b".repeat(64), actual)).toThrow(/does not match/i);
  });
});
