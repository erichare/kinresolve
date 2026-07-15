import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("hosted GEDCOM processing contract", () => {
  it("rechecks provider and bytes before worker storage reads", async () => {
    const source = await readFile("lib/integrations/run-processor.ts", "utf8");
    const processStart = source.indexOf("export async function processIntegrationSyncRun");
    const applyStart = source.indexOf("export async function applyPreparedIntegrationSyncRun");
    const processSection = source.slice(processStart, applyStart);
    const applySection = source.slice(applyStart, source.indexOf("export async function rollbackAppliedIntegrationSyncRun"));

    for (const [label, section] of [["process", processSection], ["apply", applySection]] as const) {
      expect(section, label).toContain("isIntegrationProviderEnabled(");
      expect(section, label).toContain("validateHostedGedcomFile(");
      expect(section.indexOf("validateHostedGedcomFile("), label).toBeLessThan(
        section.indexOf("readIntegrationArtifact(")
      );
    }
  });

  it("rejects parsed people before publishing a review snapshot and rechecks at apply", async () => {
    const source = await readFile("lib/integrations/run-processor.ts", "utf8");
    const processStart = source.indexOf("export async function processIntegrationSyncRun");
    const applyStart = source.indexOf("export async function applyPreparedIntegrationSyncRun");
    const processSection = source.slice(processStart, applyStart);
    const applySection = source.slice(applyStart, source.indexOf("export async function rollbackAppliedIntegrationSyncRun"));

    for (const [label, section, commitMarker, commitIndex] of [
      ["process", processSection, "commitIntegrationPreparation(", processSection.indexOf("commitIntegrationPreparation(")],
      ["apply", applySection, "applySyncRun(", applySection.lastIndexOf("applySyncRun(")]
    ] as const) {
      expect(section, label).toContain("validateHostedGedcomPeople(unnamespaced.people.length)");
      expect(section.indexOf("validateHostedGedcomPeople(unnamespaced.people.length)"), label).toBeLessThan(
        commitIndex
      );
      expect(commitIndex, `${label}:${commitMarker}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("checks the projected canonical archive before creating a backup or writing people", async () => {
    const source = await readFile("lib/workspace-store.ts", "utf8");
    const start = source.indexOf("export async function applyPreparedGedcomImportInTransaction");
    const end = source.indexOf("export async function createWorkspaceBackupInTransaction", start);
    const section = source.slice(start, end);
    const check = "validateHostedGedcomPeople(mergedPeople.length)";

    expect(section).toContain(check);
    expect(section.indexOf(check)).toBeLessThan(section.indexOf("persistWorkspaceBackupInTransaction("));
    expect(section.indexOf(check)).toBeLessThan(section.indexOf("upsertPeopleRows("));
  });
});
