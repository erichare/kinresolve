import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDatabasePools, query } from "@/lib/db";
import {
  applyPreparedIntegrationSyncRun,
  processIntegrationSyncRun
} from "@/lib/integrations/run-processor";
import {
  createIntegrationArtifact,
  createIntegrationConnection,
  listSyncChanges,
  startSyncRun
} from "@/lib/integrations/store";
import {
  createArchiveObjectStorage,
  type PrivateObjectStorageBackend
} from "@/lib/storage/object-storage";
import { readWorkspace } from "@/lib/workspace-store";
import { provisionTestArchive } from "@/tests/helpers/provision-test-archive";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

/**
 * Real provider exports repeat identifiers that are unique in a spec-perfect
 * file: a child linked to one family as both natural and adopted, duplicate
 * source catalog entries sharing an `_APID`, user reference numbers reused
 * across people. None of these shapes may kill preparation with a terminal
 * `invalid_input` failure — that regression rejected legitimate uploads with
 * an unactionable message.
 */
describeIfDatabase("integration refresh tolerates duplicated identifiers in legitimate exports", () => {
  const archiveId = `test-data-shapes-${randomUUID()}`;
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const backend: PrivateObjectStorageBackend = {
    async stat({ key }) {
      const object = objects.get(key);
      return object ? { key, size: object.bytes.length, contentType: object.contentType } : undefined;
    },
    async put({ key, bytes, contentType }) {
      objects.set(key, { bytes: Buffer.from(bytes), contentType });
    },
    async read({ key }) {
      const object = objects.get(key);
      if (!object) throw new Error("synthetic object not found");
      return object.bytes;
    },
    async delete({ key }) {
      objects.delete(key);
    }
  };
  const objectStorage = createArchiveObjectStorage({ backend });
  const options = { archiveId, databaseUrl: databaseUrl!, objectStorage };

  beforeEach(async () => {
    await provisionTestArchive(options);
  });

  afterEach(async () => {
    await query("DELETE FROM archives WHERE id = $1", [archiveId], options);
    objects.clear();
  });

  afterAll(async () => {
    await closeDatabasePools();
  });

  async function preview(gedcomLines: string[]) {
    const connection = await createIntegrationConnection(
      { provider: "ancestry_export", authority: "ancestry", displayName: "Synthetic shape export" },
      options
    );
    const bytes = Buffer.from(gedcomLines.join("\r\n"), "utf8");
    const artifact = await createIntegrationArtifact(
      connection.id,
      { fileName: "synthetic-shapes.ged", contentType: "text/plain", size: bytes.byteLength, bytes },
      options
    );
    const run = await startSyncRun(connection.id, { artifactId: artifact.id }, options);
    const preview = await processIntegrationSyncRun(run.id, options);
    return { connection, run, preview };
  }

  async function allChanges(runId: string) {
    const changes = [];
    let cursor: string | undefined;
    do {
      const page = await listSyncChanges(runId, { cursor, limit: 100 }, options);
      changes.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return changes;
  }

  const head = [
    "0 HEAD",
    "1 SOUR KIN_RESOLVE_SYNTHETIC_SHAPE_FIXTURE",
    "1 GEDC",
    "2 VERS 5.5.1",
    "2 FORM LINEAGE-LINKED",
    "1 CHAR UTF-8"
  ];

  it("previews a child linked to the same family twice as one membership and one edge", async () => {
    const { run, preview: result } = await preview([
      ...head,
      "0 @I1@ INDI",
      "1 NAME Zebulon /Fictionford/",
      "0 @I2@ INDI",
      "1 NAME Amarantha /Fictionford/",
      "0 @I3@ INDI",
      "1 NAME Peregrine /Fictionford/",
      "0 @F1@ FAM",
      "1 HUSB @I1@",
      "1 WIFE @I2@",
      "1 CHIL @I3@",
      "2 _FREL Natural",
      "2 _MREL Natural",
      "1 CHIL @I3@",
      "2 _FREL Adopted",
      "2 _MREL Adopted",
      "0 TRLR"
    ]);

    expect(result.run.status).toBe("review_ready");
    expect(result.counts.people).toBe(3);
    // One spouse edge plus one parent_child edge per parent; the repeated
    // CHIL pointer collapses into a single membership.
    expect(result.counts.relationships).toBe(3);
    const familyChanges = (await allChanges(run.id)).filter((change) => change.entityType === "family");
    expect(familyChanges).toHaveLength(1);
    expect(familyChanges[0].resolutionPayload).toMatchObject({
      values: { incoming: expect.objectContaining({ children: [expect.any(String)] }) }
    });
  });

  it("previews and applies two source catalog entries sharing one level-1 _APID", async () => {
    const { run, preview: result } = await preview([
      ...head,
      "0 @I1@ INDI",
      "1 NAME Zebulon /Fictionford/",
      "1 BIRT",
      "2 DATE 1 JAN 1850",
      "2 SOUR @S1@",
      "3 PAGE Year: 1850",
      "3 _APID 1,8054::1234567",
      "0 @S1@ SOUR",
      "1 TITL 1850 Fictional Census",
      "1 AUTH Fictional Bureau",
      "1 _APID 1,8054::0",
      "0 @S2@ SOUR",
      "1 TITL 1850 Fictional Census (duplicate catalog entry)",
      "1 AUTH Fictional Bureau",
      "1 _APID 1,8054::0",
      "0 TRLR"
    ]);

    expect(result.run.status).toBe("review_ready");
    const sourceChanges = (await allChanges(run.id)).filter((change) => change.entityType === "source");
    expect(sourceChanges).toHaveLength(2);
    const localIds = new Set(sourceChanges.map((change) => change.localEntityId));
    expect(localIds.size).toBe(2);

    const applied = await applyPreparedIntegrationSyncRun(
      run.id,
      { idempotencyKey: "apply-shared-apid", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    expect(applied.run.status).toBe("applied");

    const refs = await query<{ external_id: string; local_entity_id: string }>(
      "SELECT external_id, local_entity_id FROM external_entity_refs WHERE archive_id = $1 AND entity_type = 'source'",
      [archiveId],
      options
    );
    const rememberedExternalIds = refs.rows.map((row) => row.external_id);
    expect(rememberedExternalIds).toEqual(expect.arrayContaining(["@S1@", "@S2@"]));
    // The shared catalog identifier maps to no single entity and is never
    // remembered as a one-to-one identity.
    expect(rememberedExternalIds.filter((externalId) => externalId.startsWith("_APID:"))).toEqual([]);
  });

  it("previews and applies two people sharing one level-1 REFN as distinct people", async () => {
    const { run, preview: result } = await preview([
      ...head,
      "0 @I1@ INDI",
      "1 NAME Zebulon /Fictionford/",
      "1 REFN 42",
      "0 @I2@ INDI",
      "1 NAME Amarantha /Fictionford/",
      "1 REFN 42",
      "0 TRLR"
    ]);

    expect(result.run.status).toBe("review_ready");
    const personChanges = (await allChanges(run.id)).filter((change) => change.entityType === "person");
    expect(personChanges).toHaveLength(2);
    expect(new Set(personChanges.map((change) => change.localEntityId)).size).toBe(2);

    const applied = await applyPreparedIntegrationSyncRun(
      run.id,
      { idempotencyKey: "apply-shared-refn", resolutions: [], acceptAllSafeIncoming: true },
      options
    );
    expect(applied.run.status).toBe("applied");

    // Both people survive the apply as distinct workspace entities; a shared
    // reference number must not collapse them onto one local identity.
    const workspace = await readWorkspace(options);
    const workspaceIds = new Set(workspace.people.map((person) => person.id));
    for (const change of personChanges) {
      expect(workspaceIds.has(change.localEntityId!)).toBe(true);
    }
    const refs = await query<{ external_id: string }>(
      "SELECT external_id FROM external_entity_refs WHERE archive_id = $1 AND entity_type = 'person'",
      [archiveId],
      options
    );
    expect(refs.rows.map((row) => row.external_id)).toEqual(expect.arrayContaining(["@I1@", "@I2@"]));
    expect(refs.rows.filter((row) => row.external_id.startsWith("REFN:"))).toEqual([]);
  });

  it("previews a family whose parent slots repeat one person without a self-spouse edge", async () => {
    const { preview: result } = await preview([
      ...head,
      "0 @I1@ INDI",
      "1 NAME Zebulon /Fictionford/",
      "0 @I3@ INDI",
      "1 NAME Peregrine /Fictionford/",
      "0 @F1@ FAM",
      "1 HUSB @I1@",
      "1 WIFE @I1@",
      "1 CHIL @I3@",
      "0 TRLR"
    ]);

    expect(result.run.status).toBe("review_ready");
    expect(result.counts.relationships).toBe(1);
  });
});
