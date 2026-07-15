import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  demoFixtureVersion,
  getArchiveProvisioning,
  provisionArchive,
  requireProvisionedArchive
} from "@/lib/archive-provisioning";
import { closeDatabasePools, query } from "@/lib/db";
import { readArchiveBranding } from "@/lib/store/people-queries";
import {
  createCase,
  createEmptyWorkspace,
  readWorkspace,
  updateArchiveBranding,
  writeWorkspace
} from "@/lib/workspace-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

let storeOptions: { databaseUrl: string; archiveId: string };
let archiveIds: string[] = [];

beforeEach(() => {
  if (!databaseUrl) return;
  storeOptions = { databaseUrl, archiveId: `provision-test-${randomUUID()}` };
  archiveIds = [storeOptions.archiveId];
});

afterEach(async () => {
  if (!databaseUrl) return;
  await query("DELETE FROM archives WHERE id = ANY($1::text[])", [archiveIds], { databaseUrl });
});

afterAll(async () => {
  await closeDatabasePools();
});

describeIfDatabase("archive provisioning", () => {
  it("keeps reads and writes from creating an unprovisioned archive", async () => {
    await expect(readWorkspace(storeOptions)).rejects.toThrow(/archive.*not provisioned/i);
    await expect(readArchiveBranding(storeOptions)).rejects.toThrow(/archive.*not provisioned/i);
    await expect(createCase({ title: "No archive", question: "Should this exist?" }, storeOptions)).rejects.toThrow(
      /archive.*not provisioned/i
    );
    await expect(
      updateArchiveBranding({ name: "Should not exist", tagline: "" }, storeOptions)
    ).rejects.toThrow(/archive.*not provisioned/i);
    await expect(writeWorkspace(createEmptyWorkspace(), storeOptions)).rejects.toThrow(/archive.*not provisioned/i);

    const archive = await query<{ total: number }>(
      "SELECT count(*)::int AS total FROM archives WHERE id = $1",
      [storeOptions.archiveId],
      storeOptions
    );
    expect(archive.rows[0].total).toBe(0);
  });

  it("provisions an empty archive explicitly and idempotently", async () => {
    const first = await provisionArchive("empty", storeOptions);
    const workspace = await readWorkspace({ ...storeOptions, datasetMode: "empty" });

    expect(first).toEqual({
      archiveId: storeOptions.archiveId,
      datasetMode: "empty",
      demoFixtureVersion: null,
      created: true
    });
    expect(workspace).toMatchObject({
      archiveName: "Kin Resolve Private Archive",
      people: [],
      cases: [],
      sources: [],
      imports: []
    });

    await updateArchiveBranding({ name: "My Family Archive", tagline: "Private research" }, storeOptions);
    const second = await provisionArchive("empty", storeOptions);

    expect(second.created).toBe(false);
    await expect(readWorkspace(storeOptions)).resolves.toMatchObject({
      archiveName: "My Family Archive",
      archiveTagline: "Private research"
    });
  });

  it("provisions the versioned fictional demo without resetting later work", async () => {
    const first = await provisionArchive("demo", storeOptions);
    const initial = await readWorkspace({ ...storeOptions, datasetMode: "demo" });

    expect(first).toEqual({
      archiveId: storeOptions.archiveId,
      datasetMode: "demo",
      demoFixtureVersion,
      created: true
    });
    expect(initial.archiveName).toBe("Hartwell–Mercer Family Archive");
    expect(initial.people.length).toBeGreaterThan(0);
    expect(initial.cases.length).toBeGreaterThan(0);

    await createCase({ title: "Keep me", question: "Does idempotency preserve this?" }, storeOptions);
    const second = await provisionArchive("demo", storeOptions);
    const preserved = await readWorkspace(storeOptions);

    expect(second.created).toBe(false);
    expect(preserved.cases.some((item) => item.title === "Keep me")).toBe(true);
  });

  it("persists pilot mode as an empty private archive", async () => {
    await provisionArchive("pilot", storeOptions);

    await expect(requireProvisionedArchive({ ...storeOptions, datasetMode: "pilot" })).resolves.toMatchObject({
      archiveId: storeOptions.archiveId,
      datasetMode: "pilot",
      demoFixtureVersion: null
    });
    await expect(readWorkspace(storeOptions)).resolves.toMatchObject({
      archiveName: "Kin Resolve Private Archive",
      people: [],
      cases: []
    });

    await expect(provisionArchive("demo", storeOptions)).rejects.toThrow(/already provisioned.*pilot/i);
    expect(await getArchiveProvisioning(storeOptions)).toMatchObject({
      datasetMode: "pilot",
      demoFixtureVersion: null
    });
    await expect(readWorkspace(storeOptions)).resolves.toMatchObject({ people: [], cases: [], sources: [] });
  });

  it("serializes concurrent provisioning so exactly one caller creates the demo", async () => {
    const results = await Promise.all([provisionArchive("demo", storeOptions), provisionArchive("demo", storeOptions)]);

    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(await getArchiveProvisioning(storeOptions)).toMatchObject({
      datasetMode: "demo",
      demoFixtureVersion
    });
  });

  it("creates deterministic demo fixtures in separate fresh archives", async () => {
    const secondOptions = { databaseUrl: databaseUrl!, archiveId: `provision-test-${randomUUID()}` };
    archiveIds.push(secondOptions.archiveId);

    await provisionArchive("demo", storeOptions);
    await provisionArchive("demo", secondOptions);
    const [first, second] = await Promise.all([readWorkspace(storeOptions), readWorkspace(secondOptions)]);

    expect(first.people.map((person) => person.id)).toEqual(second.people.map((person) => person.id));
    expect(first.cases.map((researchCase) => researchCase.id)).toEqual(second.cases.map((researchCase) => researchCase.id));
    expect(first.sources.map((source) => source.id)).toEqual(second.sources.map((source) => source.id));
  });

  it("rejects persisted and expected mode mismatches without changing the archive", async () => {
    await provisionArchive("demo", storeOptions);

    await expect(requireProvisionedArchive({ ...storeOptions, datasetMode: "pilot" })).rejects.toThrow(
      /configured.*pilot.*persisted.*demo/i
    );
    await expect(readWorkspace({ ...storeOptions, datasetMode: "pilot" })).rejects.toThrow(
      /configured.*pilot.*persisted.*demo/i
    );
    await expect(provisionArchive("pilot", storeOptions)).rejects.toThrow(/already provisioned.*demo/i);

    expect(await getArchiveProvisioning(storeOptions)).toMatchObject({
      datasetMode: "demo",
      demoFixtureVersion
    });
  });
});
