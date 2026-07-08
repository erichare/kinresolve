import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyGedcomImport, readWorkspace, updatePersonCuration } from "@/lib/workspace-store";
import { prepareGedcomImport } from "@/lib/gedcom/apply";

let tempDir: string;
let storagePath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "kinsleuth-apply-"));
  storagePath = path.join(tempDir, "workspace.json");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("GEDCOM apply", () => {
  it("prepares people, sources, and raw records from GEDCOM content", () => {
    const content = readFileSync("fixtures/synthetic-family.ged", "utf8");
    const prepared = prepareGedcomImport("synthetic-family.ged", content, new Date("2026-01-01T00:00:00.000Z"));

    expect(prepared.people).toHaveLength(3);
    expect(prepared.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Synthetic Chicago birth register",
          sourceType: "GEDCOM source",
          importId: prepared.snapshot.id
        })
      ])
    );
    expect(prepared.rawRecords).toHaveLength(prepared.snapshot.records.length);
  });

  it("applies a GEDCOM into the workspace and writes a backup", async () => {
    const content = readFileSync("fixtures/synthetic-family.ged", "utf8");
    const result = await applyGedcomImport({ sourceName: "synthetic-family.ged", content }, { storagePath });
    const workspace = await readWorkspace({ storagePath });

    expect(result.import.peopleImported).toBe(3);
    expect(workspace.imports[0]).toMatchObject({
      id: result.import.id,
      backupId: result.backup.id
    });
    expect(workspace.people.map((person) => person.id)).toEqual(expect.arrayContaining(["@I1@", "@I2@", "@I3@"]));
    expect(workspace.rawRecords).toHaveLength(result.rawRecordCount);
    expect(existsSync(path.join(tempDir, result.backup.storageKey))).toBe(true);
  });

  it("preserves existing curation when an imported person is reapplied", async () => {
    const content = readFileSync("fixtures/synthetic-family.ged", "utf8");
    await applyGedcomImport({ sourceName: "synthetic-family.ged", content }, { storagePath });
    await updatePersonCuration("@I1@", { published: true, privacy: "public", livingStatus: "deceased" }, { storagePath });
    await applyGedcomImport({ sourceName: "synthetic-family.ged", content }, { storagePath });
    const workspace = await readWorkspace({ storagePath });
    const person = workspace.people.find((item) => item.id === "@I1@");

    expect(person).toMatchObject({
      published: true,
      privacy: "public",
      livingStatus: "deceased"
    });
  });
});
